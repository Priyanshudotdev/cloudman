import { describe, expect, test } from "bun:test";

import {
	buildIR,
	cidrContains,
	compileIR,
	type InfrastructureGraph,
	isValidIpv4Cidr,
	parseCidr,
	resolveDependencies,
	validateGraph,
} from "../index";

function validGraph(): InfrastructureGraph {
	return {
		version: 1,
		name: "demo",
		nodes: [
			{ id: "web-1", type: "aws_ec2", config: {} },
			{ id: "data-1", type: "aws_s3", config: { versioning: true } },
		],
		edges: [{ id: "e1", source: "web-1", target: "data-1" }],
	};
}

function networkGraph(): InfrastructureGraph {
	return {
		version: 1,
		name: "net",
		nodes: [
			{ id: "vpc-1", type: "aws_vpc", config: { cidrBlock: "10.0.0.0/16" } },
			{
				id: "subnet-1",
				type: "aws_subnet",
				config: { cidrBlock: "10.0.1.0/24" },
			},
			{
				id: "sg-1",
				type: "aws_security_group",
				config: {
					ingressRules: [
						{
							fromPort: 443,
							toPort: 443,
							protocol: "tcp",
							cidrBlock: "0.0.0.0/0",
						},
					],
				},
			},
			{ id: "web-1", type: "aws_ec2", config: {} },
		],
		edges: [
			{ source: "subnet-1", target: "vpc-1" },
			{ source: "sg-1", target: "vpc-1" },
			{ source: "web-1", target: "subnet-1" },
			{ source: "web-1", target: "sg-1" },
		],
	};
}

describe("validateGraph", () => {
	test("accepts a valid EC2 + S3 graph", () => {
		const result = validateGraph(validGraph());
		expect(result.valid).toBe(true);
		expect(result.issues).toHaveLength(0);
	});

	test("rejects unknown resource types", () => {
		const graph = validGraph();
		graph.nodes.push({ id: "db-1", type: "aws_rds", config: {} });
		const result = validateGraph(graph);
		expect(result.valid).toBe(false);
		expect(result.issues.some((i) => i.code === "UNKNOWN_RESOURCE_TYPE")).toBe(
			true,
		);
	});

	test("rejects duplicate node ids", () => {
		const graph = validGraph();
		graph.nodes.push({ id: "web-1", type: "aws_ec2", config: {} });
		const result = validateGraph(graph);
		expect(result.issues.some((i) => i.code === "DUPLICATE_NODE_ID")).toBe(
			true,
		);
	});

	test("rejects invalid enum config values with a field path", () => {
		const graph = validGraph();
		const ec2Node = graph.nodes.find((n) => n.id === "web-1");
		if (ec2Node) ec2Node.config = { instanceType: "p5.48xlarge" };
		const result = validateGraph(graph);
		expect(result.valid).toBe(false);
		const issue = result.issues.find((i) => i.code === "INVALID_CONFIG");
		expect(issue?.message).toContain("instanceType");
	});

	test("rejects unknown config keys (strict objects)", () => {
		const graph = validGraph();
		const s3Node = graph.nodes.find((n) => n.id === "data-1");
		if (s3Node) s3Node.config = { bucketSizeTb: 999 };
		const result = validateGraph(graph);
		expect(result.issues.some((i) => i.code === "INVALID_CONFIG")).toBe(true);
	});

	test("rejects self loops and unknown edge endpoints", () => {
		const result = validateGraph({
			version: 1,
			name: "bad",
			nodes: [{ id: "a", type: "aws_s3", config: {} }],
			edges: [
				{ source: "a", target: "a" },
				{ source: "a", target: "ghost" },
			],
		});
		expect(result.issues.some((i) => i.code === "EDGE_SELF_LOOP")).toBe(true);
		expect(result.issues.some((i) => i.code === "EDGE_UNKNOWN_NODE")).toBe(
			true,
		);
	});

	test("detects dependency cycles", () => {
		const result = validateGraph({
			version: 1,
			name: "cycle",
			nodes: [
				{ id: "a", type: "aws_ec2", config: {} },
				{ id: "b", type: "aws_s3", config: {} },
			],
			edges: [
				{ source: "a", target: "b" },
				{ source: "b", target: "a" },
			],
		});
		expect(result.valid).toBe(false);
		expect(result.issues.some((i) => i.code === "GRAPH_CYCLE")).toBe(true);
	});
});

describe("resolveDependencies", () => {
	test("orders dependencies before dependents", () => {
		const resolution = resolveDependencies(validGraph());
		expect(resolution.ok).toBe(true);
		if (!resolution.ok) return;
		expect(resolution.order.indexOf("data-1")).toBeLessThan(
			resolution.order.indexOf("web-1"),
		);
	});

	test("reports cycle members", () => {
		const resolution = resolveDependencies({
			version: 1,
			name: "c",
			nodes: [
				{ id: "a", type: "aws_s3", config: {} },
				{ id: "b", type: "aws_s3", config: {} },
			],
			edges: [
				{ source: "a", target: "b" },
				{ source: "b", target: "a" },
			],
		});
		expect(resolution.ok).toBe(false);
		if (resolution.ok) return;
		expect(new Set(resolution.cycle)).toEqual(new Set(["a", "b"]));
	});
});

describe("buildIR", () => {
	test("applies defaults and preserves edges as dependsOn", () => {
		const result = buildIR(validGraph(), { region: "eu-west-1" });
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.document.region).toBe("eu-west-1");
		const ec2 = result.document.resources.find((r) => r.irId === "web-1");
		const s3 = result.document.resources.find((r) => r.irId === "data-1");
		expect(ec2?.attributes.instance_type).toBe("t3.micro");
		expect(ec2?.attributes.volume_size_gb).toBe(8);
		expect(s3?.attributes.versioning).toBe(true);
		expect(s3?.attributes.bucket).toBeUndefined();
		expect(ec2?.dependsOn).toEqual(["data-1"]);
		expect(s3?.dependsOn).toEqual([]);
	});

	test("returns validation issues for invalid input", () => {
		const graph = validGraph();
		graph.edges.push({ source: "web-1", target: "missing" });
		const result = buildIR(graph);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues.length).toBeGreaterThan(0);
	});
});

describe("compileIR", () => {
	function compileValid() {
		const built = buildIR(validGraph());
		if (!built.ok) throw new Error("expected valid build");
		return compileIR(built.document, { bucketNameSuffix: "abc123" });
	}

	test("emits versions.tf with provider and region", () => {
		const files = compileValid();
		const versions = files.find((f) => f.path === "versions.tf");
		expect(versions?.contents).toContain('source  = "hashicorp/aws"');
		expect(versions?.contents).toContain('region = "us-east-1"');
	});

	test("renders instance with AMI data lookup and root volume", () => {
		const files = compileValid();
		const main = files.find((f) => f.path === "main.tf")?.contents ?? "";
		expect(main).toContain('data "aws_ami" "cloudman_base"');
		expect(main).toContain('resource "aws_instance" "web-1"');
		expect(main).toContain("ami           = data.aws_ami.cloudman_base.id");
		expect(main).toContain("volume_size = 8");
		expect(main).toContain("depends_on = [aws_s3_bucket.data-1]");
	});

	test("generates unique bucket names and conditional versioning block", () => {
		const files = compileValid();
		const main = files.find((f) => f.path === "main.tf")?.contents ?? "";
		expect(main).toContain('resource "aws_s3_bucket" "data-1"');
		expect(main).toContain('bucket        = "cloudman-data-1-abc123"');
		expect(main).toContain('resource "aws_s3_bucket_versioning" "data-1"');
		expect(main).toContain('status = "Enabled"');
	});

	test("emits outputs for every resource", () => {
		const files = compileValid();
		const outputs = files.find((f) => f.path === "outputs.tf")?.contents ?? "";
		expect(outputs).toContain('output "web-1_instance_id"');
		expect(outputs).toContain('output "data-1_bucket_id"');
	});
});

describe("cidr", () => {
	test("packs IPv4 octets into a uint32 network address", () => {
		expect(parseCidr("10.0.0.0/16")).toEqual({
			network: 10 * 2 ** 24,
			prefix: 16,
		});
		expect(parseCidr("192.168.1.0/24")).toEqual({
			network: ((192 << 24) | (168 << 16) | (1 << 8)) >>> 0,
			prefix: 24,
		});
		expect(parseCidr("10.0.1.77/24")?.network).toBe(10 * 2 ** 24 + 1 * 2 ** 8);
	});

	test("rejects malformed or out-of-range CIDRs", () => {
		expect(parseCidr("not-a-cidr")).toBeNull();
		expect(parseCidr("256.1.1.0/24")).toBeNull();
		expect(parseCidr("10.0.0.0/33")).toBeNull();
		expect(isValidIpv4Cidr("10.0.0.0/8")).toBe(true);
		expect(isValidIpv4Cidr("300.0.0.0/8")).toBe(false);
	});

	test("cidrContains handles nesting and host bits", () => {
		expect(cidrContains("10.0.0.0/16", "10.0.1.0/24")).toBe(true);
		expect(cidrContains("10.0.0.0/16", "10.0.0.0/16")).toBe(true);
		expect(cidrContains("10.0.0.0/16", "192.168.1.0/24")).toBe(false);
		expect(cidrContains("10.0.0.0/16", "10.0.0.0/8")).toBe(false);
		expect(cidrContains("10.0.1.5/24", "10.0.1.128/25")).toBe(true);
	});
});

describe("networking validation", () => {
	test("accepts a fully wired vpc/subnet/sg/ec2 stack", () => {
		const result = validateGraph(networkGraph());
		expect(result.valid).toBe(true);
		expect(result.issues).toHaveLength(0);
	});

	test("flags subnet CIDR outside its VPC block", () => {
		const graph = networkGraph();
		const subnet = graph.nodes.find((n) => n.id === "subnet-1");
		if (subnet) subnet.config.cidrBlock = "192.168.1.0/24";
		const result = validateGraph(graph);
		expect(
			result.issues.some((i) => i.code === "SUBNET_CIDR_OUTSIDE_VPC"),
		).toBe(true);
	});

	test("flags subnet with no VPC edge", () => {
		const graph = networkGraph();
		graph.edges = graph.edges.filter(
			(e) => !(e.source === "subnet-1" && e.target === "vpc-1"),
		);
		const result = validateGraph(graph);
		expect(result.issues.some((i) => i.code === "SUBNET_NO_VPC")).toBe(true);
	});

	test("flags security group with no resolvable VPC", () => {
		const graph = validGraph();
		graph.nodes.push(
			{ id: "vpc-1", type: "aws_vpc", config: {} },
			{ id: "sg-1", type: "aws_security_group", config: {} },
		);
		const result = validateGraph(graph);
		expect(result.issues.some((i) => i.code === "SG_NO_VPC")).toBe(true);
	});

	test("inherits SG VPC through attached instance's subnet", () => {
		const graph = networkGraph();
		graph.edges = graph.edges.filter(
			(e) => !(e.source === "sg-1" && e.target === "vpc-1"),
		);
		const result = validateGraph(graph);
		expect(result.valid).toBe(true);
	});

	test("rejects an instance spanning multiple subnets", () => {
		const graph = networkGraph();
		graph.nodes.push({
			id: "subnet-2",
			type: "aws_subnet",
			config: { cidrBlock: "10.0.2.0/24" },
		});
		graph.edges.push({ source: "subnet-2", target: "vpc-1" });
		graph.edges.push({ source: "web-1", target: "subnet-2" });
		const result = validateGraph(graph);
		expect(result.issues.some((i) => i.code === "EC2_MULTIPLE_SUBNETS")).toBe(
			true,
		);
	});
});

describe("networking IR + compile", () => {
	function buildNetwork() {
		const built = buildIR(networkGraph(), { region: "us-east-1" });
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		return built.document;
	}

	test("orders vpc before subnet before instance", () => {
		const document = buildNetwork();
		const ids = document.resources.map((r) => r.irId);
		expect(ids.indexOf("vpc-1")).toBeLessThan(ids.indexOf("subnet-1"));
		expect(ids.indexOf("subnet-1")).toBeLessThan(ids.indexOf("web-1"));
	});

	test("injects ref attributes into IR", () => {
		const document = buildNetwork();
		const ec2 = document.resources.find((r) => r.irId === "web-1");
		const subnet = document.resources.find((r) => r.irId === "subnet-1");
		const sg = document.resources.find((r) => r.irId === "sg-1");
		expect(ec2?.attributes.subnet_ref).toBe("subnet-1");
		expect(ec2?.attributes.security_group_refs).toEqual(["sg-1"]);
		expect(subnet?.attributes.vpc_ref).toBe("vpc-1");
		expect(sg?.attributes.vpc_ref).toBe("vpc-1");
	});

	test("emits tofu wiring for the networking stack", () => {
		const files = compileIR(buildNetwork());
		const main = files.find((f) => f.path === "main.tf")?.contents ?? "";

		expect(main).toContain('resource "aws_vpc" "vpc-1"');
		expect(main).toContain('cidr_block           = "10.0.0.0/16"');
		expect(main).toContain('resource "aws_subnet" "subnet-1"');
		expect(main).toContain("vpc_id     = aws_vpc.vpc-1.id");
		expect(main).toContain('resource "aws_security_group" "sg-1"');
		expect(main).toContain('name        = "cloudman-sg-1"');
		expect(main).toContain("from_port   = 443");
		expect(main).toContain('cidr_blocks = ["0.0.0.0/0"]');
		expect(main).toContain('protocol    = "-1"');

		const ec2Block = main.slice(main.indexOf('resource "aws_instance"'));
		expect(ec2Block).toContain("subnet_id     = aws_subnet.subnet-1.id");
		expect(ec2Block).toContain(
			"vpc_security_group_ids = [aws_security_group.sg-1.id]",
		);

		const outputs = files.find((f) => f.path === "outputs.tf")?.contents ?? "";
		expect(outputs).toContain('output "vpc-1_vpc_id"');
		expect(outputs).toContain('output "subnet-1_subnet_id"');
		expect(outputs).toContain('output "sg-1_security_group_id"');
	});
});
