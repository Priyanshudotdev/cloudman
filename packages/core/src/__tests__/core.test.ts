import { describe, expect, test } from "bun:test";

import {
	buildIR,
	compileIR,
	type InfrastructureGraph,
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
