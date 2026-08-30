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
		graph.nodes.push({ id: "db-1", type: "aws_redshift", config: {} });
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

describe("data tier resources", () => {
	function dataGraph(): InfrastructureGraph {
		return {
			version: 1,
			name: "data",
			nodes: [
				{ id: "vpc-1", type: "aws_vpc", config: { cidrBlock: "10.0.0.0/16" } },
				{
					id: "subnet-1",
					type: "aws_subnet",
					config: { cidrBlock: "10.0.1.0/24" },
				},
				{
					id: "subnet-2",
					type: "aws_subnet",
					config: { cidrBlock: "10.0.2.0/24" },
				},
				{ id: "sg-1", type: "aws_security_group", config: {} },
				{
					id: "db-1",
					type: "aws_rds",
					config: {},
				},
				{
					id: "kv-1",
					type: "aws_dynamodb_table",
					config: { rangeKey: "sk" },
				},
			],
			edges: [
				{ source: "subnet-1", target: "vpc-1" },
				{ source: "subnet-2", target: "vpc-1" },
				{ source: "sg-1", target: "vpc-1" },
				{ source: "db-1", target: "subnet-1" },
				{ source: "db-1", target: "subnet-2" },
				{ source: "db-1", target: "sg-1" },
			],
		};
	}

	test("accepts rds wired to two subnets + sg and standalone dynamodb", () => {
		const result = validateGraph(dataGraph());
		expect(result.valid).toBe(true);
		expect(result.issues).toHaveLength(0);
	});

	test("flags rds with fewer than two subnets", () => {
		const graph = dataGraph();
		graph.edges = graph.edges.filter(
			(e) => !(e.source === "db-1" && e.target === "subnet-2"),
		);
		const result = validateGraph(graph);
		expect(result.issues.some((i) => i.code === "RDS_SUBNET_COUNT")).toBe(true);
	});

	test("injects plural subnet refs and sg refs into rds IR", () => {
		const built = buildIR(dataGraph());
		if (!built.ok) throw new Error(JSON.stringify(built.issues));
		const db = built.document.resources.find((r) => r.irId === "db-1");
		expect(db?.attributes.subnet_refs).toEqual(["subnet-1", "subnet-2"]);
		expect(db?.attributes.security_group_refs).toEqual(["sg-1"]);
		expect(db?.attributes.engine).toBe("postgres");
		expect(db?.attributes.manage_master_user_password).toBeUndefined();
	});

	test("compiles dynamodb table with hash and range attributes", () => {
		const built = buildIR(dataGraph());
		if (!built.ok) throw new Error("expected valid build");
		const files = compileIR(built.document, { bucketNameSuffix: "abc123" });
		const main = files.find((f) => f.path === "main.tf")?.contents ?? "";

		expect(main).toContain('resource "aws_dynamodb_table" "kv-1"');
		expect(main).toContain('name         = "cloudman-kv-1-abc123"');
		expect(main).toContain('hash_key     = "id"');
		expect(main).toContain('name = "sk"');
		expect(main).toContain('type = "S"');
		expect(main).toContain('billing_mode = "PAY_PER_REQUEST"');
	});

	test("synthesizes db subnet group and wires the instance to it", () => {
		const built = buildIR(dataGraph());
		if (!built.ok) throw new Error("expected valid build");
		const files = compileIR(built.document, { bucketNameSuffix: "abc123" });
		const main = files.find((f) => f.path === "main.tf")?.contents ?? "";

		expect(main).toContain('resource "aws_db_subnet_group" "db-1-subnets"');
		expect(main).toContain(
			"subnet_ids = [aws_subnet.subnet-1.id, aws_subnet.subnet-2.id]",
		);
		expect(main).toContain('resource "aws_db_instance" "db-1"');
		expect(main).toContain("manage_master_user_password = true");
		expect(main).toContain(
			"db_subnet_group_name = aws_db_subnet_group.db-1-subnets.name",
		);
		expect(main).toContain(
			"vpc_security_group_ids = [aws_security_group.sg-1.id]",
		);

		const outputs = files.find((f) => f.path === "outputs.tf")?.contents ?? "";
		expect(outputs).toContain('output "db-1_db_id"');
		expect(outputs).toContain('output "kv-1_table_id"');
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

function vpcStack(): InfrastructureGraph {
	return {
		version: 1,
		name: "stack",
		nodes: [
			{ id: "vpc-1", type: "aws_vpc", config: { cidrBlock: "10.0.0.0/16" } },
			{
				id: "subnet-1",
				type: "aws_subnet",
				config: { cidrBlock: "10.0.1.0/24" },
			},
			{
				id: "subnet-2",
				type: "aws_subnet",
				config: { cidrBlock: "10.0.2.0/24" },
			},
			{ id: "sg-1", type: "aws_security_group", config: {} },
		],
		edges: [
			{ source: "subnet-1", target: "vpc-1" },
			{ source: "subnet-2", target: "vpc-1" },
			{ source: "sg-1", target: "vpc-1" },
		],
	};
}

function node(
	graph: InfrastructureGraph,
	id: string,
	type: string,
	config: Record<string, unknown> = {},
): void {
	graph.nodes.push({ id, type, config });
	graph.edges.push({ source: id, target: "vpc-1" });
}

function connect(
	graph: InfrastructureGraph,
	source: string,
	target: string,
): void {
	graph.edges.push({ source, target });
}

function compiled(graph: InfrastructureGraph): string {
	const built = buildIR(graph, { region: "us-east-1" });
	if (!built.ok) throw new Error(JSON.stringify(built.issues));
	const files = compileIR(built.document, { bucketNameSuffix: "ab12cd" });
	return files.find((f) => f.path === "main.tf")?.contents ?? "";
}

describe("catalog v2 validation", () => {
	test("accepts a full extranet stack (igw + nat + alb)", () => {
		const graph = vpcStack();
		node(graph, "web-1", "aws_ec2");
		connect(graph, "web-1", "subnet-1");
		connect(graph, "web-1", "sg-1");
		node(graph, "ig-1", "aws_internet_gateway");
		node(graph, "nat-1", "aws_nat_gateway", { connectivityType: "public" });
		connect(graph, "nat-1", "subnet-1");
		node(graph, "alb-1", "aws_alb");
		connect(graph, "alb-1", "subnet-1");
		connect(graph, "alb-1", "subnet-2");
		connect(graph, "alb-1", "sg-1");
		connect(graph, "web-1", "alb-1");
		const result = validateGraph(graph);
		expect(result.valid).toBe(true);
		expect(result.issues).toHaveLength(0);
	});

	test("flags networking consumers missing their wiring", () => {
		const missing = (
			type: string,
			edges: Array<[string, string]>,
			config = {},
		): string[] => {
			const graph = vpcStack();
			graph.nodes.push({ id: "r-1", type, config });
			for (const [source, target] of edges)
				graph.edges.push({ source, target });
			return validateGraph(graph).issues.map((i) => i.code);
		};
		expect(missing("aws_internet_gateway", [])).toContain("IGW_NO_VPC");
		expect(missing("aws_nat_gateway", [])).toContain("NAT_NO_SUBNET");
		expect(missing("aws_alb", [])).toContain("ALB_NO_SUBNETS");
		expect(missing("aws_ebs", [])).toContain("EBS_NO_INSTANCE");
		expect(missing("aws_efs", [])).toContain("EFS_NO_SUBNET");
		expect(missing("aws_aurora", [["r-1", "subnet-1"]])).toContain(
			"AURORA_SUBNET_COUNT",
		);
		expect(missing("aws_elasticache", [])).toContain("ELASTICACHE_NO_SUBNETS");
	});

	test("flags lambda without role/repository and ecs without role/image/subnets", () => {
		const graph = vpcStack();
		node(graph, "fn-1", "aws_lambda");
		expect(validateGraph(graph).issues.map((i) => i.code)).toEqual(
			expect.arrayContaining(["LAMBDA_NO_ROLE", "LAMBDA_NO_REPOSITORY"]),
		);

		const graph2 = vpcStack();
		node(graph2, "svc-1", "aws_ecs");
		const codes2 = validateGraph(graph2).issues.map((i) => i.code);
		expect(codes2).toContain("ECS_NO_SUBNETS");
		expect(codes2).toContain("ECS_NO_ROLE");
		expect(codes2).toContain("ECS_NO_IMAGE");

		const graph3 = vpcStack();
		node(graph3, "fn-2", "aws_lambda", { codeSource: "zip" });
		connect(graph3, "fn-2", "role-1");
		const codes3 = validateGraph(graph3).issues.map((i) => i.code);
		expect(codes3).toContain("LAMBDA_NO_ZIP_SOURCE");
	});

	test("flags iam policy, dns records, and api gateway standalone nodes", () => {
		const graph = vpcStack();
		node(graph, "policy-1", "aws_iam_policy");
		expect(validateGraph(graph).issues.map((i) => i.code)).toContain(
			"POLICY_NO_ROLE",
		);

		const graph2 = vpcStack();
		graph2.nodes.push({
			id: "zone-1",
			type: "aws_route53_zone",
			config: { zoneName: "example.com", privateZone: true },
		});
		expect(validateGraph(graph2).issues.map((i) => i.code)).toContain(
			"PRIVATE_ZONE_NO_VPC",
		);

		const graph3 = vpcStack();
		node(graph3, "zone-2", "aws_route53_zone", { zoneName: "example.com" });
		node(graph3, "rec-1", "aws_route53_record", { recordName: "app" });
		connect(graph3, "rec-1", "zone-2");
		const codes3 = validateGraph(graph3).issues.map((i) => i.code);
		expect(codes3).toContain("RECORD_NO_TARGET");

		const graph4 = vpcStack();
		node(graph4, "alb-x", "aws_alb");
		node(graph4, "zone-3", "aws_route53_zone", { zoneName: "example.com" });
		node(graph4, "rec-2", "aws_route53_record", {
			recordName: "app",
			recordType: "CNAME",
		});
		connect(graph4, "rec-2", "zone-3");
		connect(graph4, "rec-2", "alb-x");
		expect(validateGraph(graph4).issues.map((i) => i.code)).toContain(
			"RECORD_BAD_ALIAS_TYPE",
		);

		const graph5 = vpcStack();
		node(graph5, "api-1", "aws_apigateway");
		expect(validateGraph(graph5).issues.map((i) => i.code)).toContain(
			"GATEWAY_NO_LAMBDA",
		);
	});
});

describe("catalog v2 IR + compile", () => {
	test("compiles igw + public nat (with eip)", () => {
		const graph = vpcStack();
		node(graph, "ig-1", "aws_internet_gateway");
		node(graph, "nat-1", "aws_nat_gateway", { connectivityType: "public" });
		connect(graph, "nat-1", "subnet-1");
		const main = compiled(graph);
		expect(main).toContain('resource "aws_internet_gateway" "ig-1"');
		expect(main).toContain("vpc_id = aws_vpc.vpc-1.id");
		expect(main).toContain('resource "aws_eip" "nat-1-eip"');
		expect(main).toContain("allocation_id = aws_eip.nat-1-eip.id");
		expect(main).toContain('connectivity_type = "public"');
	});

	test("compiles alb with target group, listener, and attachment", () => {
		const graph = vpcStack();
		node(graph, "web-1", "aws_ec2");
		connect(graph, "web-1", "subnet-1");
		connect(graph, "web-1", "sg-1");
		node(graph, "alb-1", "aws_alb");
		connect(graph, "alb-1", "subnet-1");
		connect(graph, "alb-1", "subnet-2");
		connect(graph, "alb-1", "sg-1");
		connect(graph, "web-1", "alb-1");
		const main = compiled(graph);
		expect(main).toContain('resource "aws_lb" "alb-1"');
		expect(main).toContain('load_balancer_type = "application"');
		expect(main).toContain(
			"subnets = [aws_subnet.subnet-1.id, aws_subnet.subnet-2.id]",
		);
		expect(main).toContain('resource "aws_lb_target_group" "alb-1-tg"');
		expect(main).toContain('resource "aws_lb_listener" "alb-1-listener"');
		expect(main).toContain(
			'resource "aws_lb_target_group_attachment" "alb-1-target-1"',
		);
		expect(main).toContain("target_id        = aws_instance.web-1.id");
	});

	test("compiles ebs + efs + aurora + elasticache synthesized wiring", () => {
		const graph = vpcStack();
		node(graph, "web-1", "aws_ec2");
		connect(graph, "web-1", "subnet-1");
		connect(graph, "web-1", "sg-1");
		node(graph, "vol-1", "aws_ebs");
		connect(graph, "vol-1", "web-1");
		node(graph, "fs-1", "aws_efs");
		connect(graph, "fs-1", "subnet-1");
		connect(graph, "fs-1", "sg-1");
		node(graph, "aurora-1", "aws_aurora");
		connect(graph, "aurora-1", "subnet-1");
		connect(graph, "aurora-1", "subnet-2");
		connect(graph, "aurora-1", "sg-1");
		node(graph, "cache-1", "aws_elasticache");
		connect(graph, "cache-1", "subnet-1");
		connect(graph, "cache-1", "sg-1");
		const main = compiled(graph);

		expect(main).toContain('resource "aws_ebs_volume" "vol-1"');
		expect(main).toContain(
			"availability_zone = aws_instance.web-1.availability_zone",
		);
		expect(main).toContain('resource "aws_volume_attachment" "vol-1-attach"');
		expect(main).toContain("instance_id = aws_instance.web-1.id");

		expect(main).toContain('resource "aws_efs_file_system" "fs-1"');
		expect(main).toContain('resource "aws_efs_mount_target" "fs-1-mt-1"');

		expect(main).toContain(
			'resource "aws_rds_subnet_group" "aurora-1-subnets"',
		);
		expect(main).toContain('resource "aws_rds_cluster" "aurora-1"');
		expect(main).toContain('engine             = "aurora-postgresql"');
		expect(main).toContain(
			'resource "aws_rds_cluster_instance" "aurora-1-instance"',
		);

		expect(main).toContain(
			'resource "aws_elasticache_subnet_group" "cache-1-subnets"',
		);
		expect(main).toContain('resource "aws_elasticache_cluster" "cache-1"');
		expect(main).toContain("port                 = 6379");
	});

	test("compiles lambda (image mode) with role + ecr and env wiring", () => {
		const graph = vpcStack();
		node(graph, "repo-1", "aws_ecr");
		node(graph, "role-1", "aws_iam_role", { assumeService: "lambda" });
		node(graph, "fn-1", "aws_lambda");
		connect(graph, "fn-1", "subnet-1");
		connect(graph, "fn-1", "sg-1");
		connect(graph, "fn-1", "role-1");
		connect(graph, "fn-1", "repo-1");
		const main = compiled(graph);

		expect(main).toContain('resource "aws_ecr_repository" "repo-1"');
		expect(main).toContain('resource "aws_iam_role" "role-1"');
		expect(main).toContain("lambda.amazonaws.com");
		expect(main).toContain('resource "aws_lambda_function" "fn-1"');
		expect(main).toContain("role          = aws_iam_role.role-1.arn");
		expect(main).toContain(
			'image_uri = "$' + '{aws_ecr_repository.repo-1.repository_url}:latest"',
		);
		expect(main).toContain('log_format = "JSON"');
		expect(main).toContain("subnet_ids         = [aws_subnet.subnet-1.id]");
	});

	test("compiles lambda (zip mode) with s3 source", () => {
		const graph = vpcStack();
		node(graph, "role-1", "aws_iam_role");
		node(graph, "fn-1", "aws_lambda", {
			codeSource: "zip",
			s3CodeBucket: "artifacts",
			s3CodeKey: "bundle.zip",
		});
		connect(graph, "fn-1", "role-1");
		const main = compiled(graph);
		expect(main).toContain('runtime = "nodejs22.x"');
		expect(main).toContain('handler = "index.handler"');
		expect(main).toContain('s3_bucket = "artifacts"');
		expect(main).toContain('s3_key    = "bundle.zip"');
	});

	test("compiles ecs cluster, task, and service referencing the wired ecr image", () => {
		const graph = vpcStack();
		node(graph, "repo-1", "aws_ecr");
		node(graph, "role-1", "aws_iam_role", { assumeService: "ecs-tasks" });
		node(graph, "svc-1", "aws_ecs");
		connect(graph, "svc-1", "subnet-1");
		connect(graph, "svc-1", "sg-1");
		connect(graph, "svc-1", "role-1");
		connect(graph, "svc-1", "repo-1");
		const main = compiled(graph);

		expect(main).toContain('resource "aws_ecs_cluster" "svc-1-cluster"');
		expect(main).toContain('resource "aws_ecs_task_definition" "svc-1-task"');
		expect(main).toContain('"cloudman-svc-1-ab12cd-svc"');
		expect(main).toContain('network_mode             = "awsvpc"');
		expect(main).toContain('resource "aws_ecs_service" "svc-1-service"');
		expect(main).toContain(
			'"$' + '{aws_ecr_repository.repo-1.repository_url}:latest"',
		);
		expect(main).toContain('awslogs-group         = "/ecs/cloudman-svc-1"');
	});

	test("compiles iam policy attached to a role plus sqs/sns/log group", () => {
		const graph = vpcStack();
		node(graph, "role-1", "aws_iam_role");
		node(graph, "policy-1", "aws_iam_policy", {
			actions: ["s3:GetObject", "s3:PutObject"],
			resources: ["arn:aws:s3:::my-bucket/*"],
		});
		connect(graph, "policy-1", "role-1");
		node(graph, "queue-1", "aws_sqs", { fifo: true });
		node(graph, "topic-1", "aws_sns", { displayName: "alerts" });
		node(graph, "logs-1", "aws_cloudwatch_log_group", { retentionDays: 30 });
		const main = compiled(graph);

		expect(main).toContain('resource "aws_iam_policy" "policy-1"');
		expect(main).toContain("s3:GetObject");
		expect(main).toContain("s3:PutObject");
		expect(main).toContain("arn:aws:s3:::my-bucket/*");
		expect(main).toContain(
			'resource "aws_iam_role_policy_attachment" "policy-1-attach-1"',
		);
		expect(main).toContain("role       = aws_iam_role.role-1.name");
		expect(main).toContain('resource "aws_sqs_queue" "queue-1"');
		expect(main).toContain(
			'name                       = "cloudman-queue-1.fifo"',
		);
		expect(main).toContain("fifo_queue                 = true");
		expect(main).toContain('resource "aws_sns_topic" "topic-1"');
		expect(main).toContain('display_name = "alerts"');
		expect(main).toContain('resource "aws_cloudwatch_log_group" "logs-1"');
		expect(main).toContain('name              = "/cloudman/logs-1"');
		expect(main).toContain("retention_in_days = 30");
	});

	test("compiles private zone + alias record to alb", () => {
		const graph = vpcStack();
		node(graph, "web-1", "aws_ec2");
		connect(graph, "web-1", "subnet-1");
		connect(graph, "web-1", "sg-1");
		node(graph, "alb-1", "aws_alb");
		connect(graph, "alb-1", "subnet-1");
		connect(graph, "alb-1", "subnet-2");
		connect(graph, "web-1", "alb-1");
		node(graph, "zone-1", "aws_route53_zone", {
			zoneName: "example.com",
			privateZone: true,
		});
		node(graph, "rec-1", "aws_route53_record", { recordName: "api" });
		connect(graph, "rec-1", "zone-1");
		connect(graph, "rec-1", "alb-1");
		const main = compiled(graph);

		expect(main).toContain('resource "aws_route53_zone" "zone-1"');
		expect(main).toContain('name = "example.com"');
		expect(main).toContain("vpc_id = aws_vpc.vpc-1.id");
		expect(main).toContain('resource "aws_route53_record" "rec-1"');
		expect(main).toContain("zone_id = aws_route53_zone.zone-1.zone_id");
		expect(main).toContain('name    = "api.example.com"');
		expect(main).toContain("name                   = aws_lb.alb-1.dns_name");
		expect(main).toContain("zone_id                = aws_lb.alb-1.zone_id");
	});

	test("compiles static dns record with record values", () => {
		const graph = vpcStack();
		node(graph, "zone-1", "aws_route53_zone", { zoneName: "example.com" });
		node(graph, "rec-1", "aws_route53_record", {
			recordName: "www",
			records: ["203.0.113.10"],
		});
		connect(graph, "rec-1", "zone-1");
		const main = compiled(graph);
		expect(main).toContain('type    = "A"');
		expect(main).toContain("ttl     = 300");
		expect(main).toContain('records = ["203.0.113.10"]');
	});

	test("compiles api gateway fronting a lambda", () => {
		const graph = vpcStack();
		node(graph, "repo-1", "aws_ecr");
		node(graph, "role-1", "aws_iam_role");
		node(graph, "fn-1", "aws_lambda");
		connect(graph, "fn-1", "role-1");
		connect(graph, "fn-1", "repo-1");
		node(graph, "api-1", "aws_apigateway");
		connect(graph, "api-1", "fn-1");
		const main = compiled(graph);

		expect(main).toContain('resource "aws_api_gateway_rest_api" "api-1"');
		expect(main).toContain(
			'resource "aws_api_gateway_resource" "api-1-resource"',
		);
		expect(main).toContain('resource "aws_api_gateway_method" "api-1-method"');
		expect(main).toContain(
			'resource "aws_api_gateway_integration" "api-1-integration"',
		);
		expect(main).toContain('type                    = "AWS_PROXY"');
		expect(main).toContain(
			'uri                     = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/$' +
				"{" +
				'aws_lambda_function.fn-1.arn}/invocations"',
		);
		expect(main).toContain(
			'resource "aws_lambda_permission" "api-1-permission"',
		);
		expect(main).toContain('source_arn    = "arn:aws:execute-api:*:*:*/*"');
		expect(main).toContain(
			'resource "aws_api_gateway_deployment" "api-1-deployment"',
		);
		expect(main).toContain('resource "aws_api_gateway_stage" "api-1-stage"');
	});
});
