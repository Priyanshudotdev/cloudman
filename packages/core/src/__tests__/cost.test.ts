import { describe, expect, test } from "bun:test";

import {
	analyzeRisks,
	buildIR,
	estimateCost,
	estimateResource,
	type InfrastructureGraph,
	type IRDocument,
} from "../index";

const vpc = {
	id: "vpc-1",
	type: "aws_vpc",
	config: { cidrBlock: "10.0.0.0/16" },
};
const subnetA = {
	id: "subnet-a",
	type: "aws_subnet",
	config: { cidrBlock: "10.0.1.0/24" },
};
const subnetB = {
	id: "subnet-b",
	type: "aws_subnet",
	config: { cidrBlock: "10.0.2.0/24" },
};
const sg = {
	id: "sg-1",
	type: "aws_security_group",
	config: { description: "app" },
};
const role = { id: "role-1", type: "aws_iam_role", config: {} };
const web = { id: "web-1", type: "aws_ec2", config: {} };

type Node = { id: string; type: string; config: Record<string, unknown> };
type Edge = { id: string; source: string; target: string };

function baseWires(): Edge[] {
	return [
		{ id: "e1", source: subnetA.id, target: vpc.id },
		{ id: "e2", source: subnetB.id, target: vpc.id },
		{ id: "e3", source: sg.id, target: vpc.id },
	];
}

function build(
	nodes: Node[],
	extraEdges: Edge[] = [],
): { document: IRDocument } {
	const present = new Set(nodes.map((n) => n.id));
	for (const edge of extraEdges) {
		present.add(edge.source);
		present.add(edge.target);
	}
	const wantVpc =
		present.has(vpc.id) ||
		[subnetA, subnetB, sg].some((base) => present.has(base.id));
	if (wantVpc) present.add(vpc.id);

	let all = [...nodes];
	for (const base of [vpc, subnetA, subnetB, sg] as Node[]) {
		if (present.has(base.id) && !all.some((n) => n.id === base.id)) {
			all = [...all, base];
		}
	}

	const wires = baseWires().filter((edge) =>
		all.some((n) => n.id === edge.source),
	);

	const graph: InfrastructureGraph = {
		version: 1,
		name: "cost-demo",
		nodes: all,
		edges: [...wires, ...extraEdges],
	};
	const result = buildIR(graph);
	if (!result.ok) {
		throw new Error(
			`graph should build: ${result.issues.map((i) => i.code).join(", ")}`,
		);
	}
	return result;
}

describe("estimateCost", () => {
	test("bills an EC2 by instance type plus root volume", () => {
		const { document } = build([web]);
		const report = estimateCost(document);
		expect(report.resources).toHaveLength(1);
		const row = report.resources[0];
		expect(row?.monthly).toBeCloseTo(0.0104 * 730 + 8 * 0.08, 2);
		expect(report.monthlyTotal).toBeCloseTo(row?.monthly ?? 0, 2);
		expect(report.topSpenders).toContain("web-1");
	});

	test("t2.micro + t3.medium are costed differently", () => {
		const { document } = build([
			{ id: "a", type: "aws_ec2", config: { instanceType: "t2.micro" } },
			{ id: "b", type: "aws_ec2", config: { instanceType: "t3.medium" } },
		]);
		const report = estimateCost(document);
		const byId = new Map(report.resources.map((r) => [r.irId, r.monthly]));
		expect(byId.get("a")).toBeLessThan(
			byId.get("b") ?? Number.POSITIVE_INFINITY,
		);
	});

	test("RDS adds storage on top of instance hours", () => {
		const { document } = build(
			[
				{
					id: "db",
					type: "aws_rds",
					config: { instanceClass: "db.t3.small", allocatedStorageGb: 20 },
				},
			],
			[
				{ id: "r1", source: "db", target: subnetA.id },
				{ id: "r2", source: "db", target: subnetB.id },
				{ id: "r3", source: "db", target: sg.id },
			],
		);
		const report = estimateCost(document);
		const row = report.resources.find((r) => r.irId === "db");
		expect(row?.monthly).toBeCloseTo(0.033 * 730 + 20 * 0.08, 2);
	});

	test("ElastiCache scales with node count", () => {
		const nodes = [
			{ id: "c", type: "aws_elasticache", config: { numCacheNodes: 1 } },
		];
		const wires = [
			{ id: "c1", source: "c", target: subnetA.id },
			{ id: "c2", source: "c", target: sg.id },
		];
		const { document: one } = build(nodes, wires);
		const { document: four } = build(
			[{ id: "c", type: "aws_elasticache", config: { numCacheNodes: 4 } }],
			wires,
		);
		expect(estimateCost(four).monthlyTotal).toBeCloseTo(
			estimateCost(one).monthlyTotal * 4,
			2,
		);
	});

	test("ECS uses Fargate vCPU/GB sizing via desired count", () => {
		const { document } = build(
			[
				{
					id: "srv",
					type: "aws_ecs",
					config: {
						cpu: "1 vCPU",
						memory: "2 GB",
						desiredCount: 2,
						image: "repo/app:v1",
					},
				},
				role,
			],
			[
				{ id: "s1", source: "srv", target: subnetA.id },
				{ id: "s2", source: "srv", target: sg.id },
				{ id: "s3", source: "srv", target: role.id },
			],
		);
		const report = estimateCost(document);
		const each = (1 * 0.04048 + 2 * 0.004445) * 730;
		expect(report.monthlyTotal).toBeCloseTo(each * 2, 2);
	});

	test("NAT gateway and ALB carry meaningful base costs", () => {
		const { document } = build(
			[
				{ id: "nat", type: "aws_nat_gateway", config: {} },
				{ id: "lb", type: "aws_alb", config: {} },
			],
			[
				{ id: "n1", source: "nat", target: subnetA.id },
				{ id: "l1", source: "lb", target: subnetA.id },
				{ id: "l2", source: "lb", target: subnetB.id },
			],
		);
		const report = estimateCost(document);
		expect(report.monthlyTotal).toBeCloseTo(0.045 * 730 + 16.43, 2);
	});

	test("free-tier kinds are zero and notes explain why", () => {
		const igw = { id: "igw-1", type: "aws_internet_gateway", config: {} };
		const { document } = build(
			[vpc, igw],
			[{ id: "g1", source: igw.id, target: vpc.id }],
		);
		const report = estimateCost(document);
		expect(report.monthlyTotal).toBe(0);
		for (const row of report.resources) {
			expect(row.share).toBe(0);
			expect(row.notes.length).toBeGreaterThan(0);
		}
	});

	test("report sorts spenders descending and computes share", () => {
		const { document } = build([
			{ id: "big", type: "aws_ec2", config: { instanceType: "t3.medium" } },
			{ id: "small", type: "aws_ec2", config: { instanceType: "t2.micro" } },
			vpc,
		]);
		const report = estimateCost(document);
		expect(report.resources[0]?.irId).toBe("big");
		expect(report.resources[1]?.irId).toBe("small");
		for (const row of report.resources) {
			expect(row.share).toBeGreaterThanOrEqual(0);
			expect(row.share).toBeLessThanOrEqual(1);
		}
	});

	test("estimateResource is deterministic for unknown kinds", () => {
		const a = estimateResource({
			irId: "x",
			kind: "aws_mystery",
			name: "mystery",
			attributes: {},
			dependsOn: [],
		});
		const b = estimateResource({
			irId: "x",
			kind: "aws_mystery",
			name: "mystery",
			attributes: {},
			dependsOn: [],
		});
		expect(a).toEqual(b);
		expect(a.monthly).toBe(0);
	});
});

describe("analyzeRisks", () => {
	test("flags world-open security groups", () => {
		const { document } = build(
			[
				{
					id: "sg-1",
					type: "aws_security_group",
					config: {
						description: "open",
						ingressRules: [
							{
								fromPort: 22,
								toPort: 22,
								protocol: "tcp",
								cidrBlock: "0.0.0.0/0",
							},
						],
					},
				},
			],
			[],
		);
		const risks = analyzeRisks(document);
		expect(
			risks.some((r) => r.code === "SG_WORLD_OPEN" && r.severity === "medium"),
		).toBe(true);
	});

	test("flags public RDS and unencrypted volumes/storage", () => {
		const { document } = build(
			[
				{
					id: "db",
					type: "aws_rds",
					config: { publiclyAccessible: true },
				},
				{ id: "vol", type: "aws_ebs", config: { encrypted: false } },
				{ id: "fs", type: "aws_efs", config: { encrypted: false } },
				web,
			],
			[
				{ id: "d1", source: "db", target: subnetA.id },
				{ id: "d2", source: "db", target: subnetB.id },
				{ id: "d3", source: "db", target: sg.id },
				{ id: "v1", source: "vol", target: web.id },
				{ id: "f1", source: "fs", target: subnetA.id },
			],
		);
		const risks = analyzeRisks(document);
		const codes = risks.map((r) => r.code);
		expect(codes).toContain("DB_PUBLIC");
		expect(codes).toContain("EBS_UNENCRYPTED");
		expect(codes).toContain("EFS_UNENCRYPTED");
		for (const risk of risks.filter((r) => r.severity === "high")) {
			expect(risk.message.length).toBeGreaterThan(0);
		}
	});

	test("flags S3 missing versioning and a NAT cost hotspot", () => {
		const { document } = build(
			[
				{ id: "b", type: "aws_s3", config: { versioning: false } },
				{ id: "nat", type: "aws_nat_gateway", config: {} },
			],
			[{ id: "n1", source: "nat", target: subnetA.id }],
		);
		const risks = analyzeRisks(document);
		const codes = risks.map((r) => r.code);
		expect(codes).toContain("S3_NO_VERSIONING");
		expect(codes).toContain("NAT_COST_HOTSPOT");
	});

	test("does not nag when hardening flags are satisfied", () => {
		const { document } = build(
			[
				{ id: "b", type: "aws_s3", config: { versioning: true } },
				{ id: "vol", type: "aws_ebs", config: { encrypted: true } },
				web,
			],
			[{ id: "v1", source: "vol", target: web.id }],
		);
		const risks = analyzeRisks(document);
		const codes = risks.map((r) => r.code);
		expect(codes).not.toContain("S3_NO_VERSIONING");
		expect(codes).not.toContain("EBS_UNENCRYPTED");
	});
});
