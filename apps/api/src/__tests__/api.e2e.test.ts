import { beforeAll, describe, expect, test } from "bun:test";

process.env.DATABASE_URL = "mongodb://127.0.0.1:27017/cloudman_test";
process.env.REDIS_URL = "redis://127.0.0.1:6379/15";
process.env.NODE_ENV = "test";
process.env.CLOUDMAN_WORKER_MOCK = "1";
process.env.CLOUDMAN_SECRET = "ab".repeat(32);
process.env.BETTER_AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.BETTER_AUTH_URL = "http://localhost:4000";
process.env.CORS_ORIGIN = "http://localhost:3001";
process.env.SKIP_ENV_VALIDATION = "true";

const originalGetBuiltinModule: (id: string) => NodeJS.Module | undefined =
	// biome-ignore lint/style/noNonNullAssertion: process prod isn't pre-patched
	process.getBuiltinModule!;
process.getBuiltinModule = (id: string) =>
	// bson 7 calls node:v8 startupSnapshot.isBuildingSnapshot() at import time,
	// which Bun throws NotImplementedError on. Returning undefined lets bson's
	// `?? {}` fallback skip the branch.
	id === "v8" ? undefined : originalGetBuiltinModule(id);

import type { Hono } from "hono";
import type { AppEnv } from "../lib/session";

const TEST_USER_ID = "64b000000000000000000001";

function validGraph(): Record<string, unknown> {
	return {
		version: 1,
		name: "e2e-stack",
		nodes: [
			{ id: "vpc-1", type: "aws_vpc", config: { cidrBlock: "10.0.0.0/16" } },
			{
				id: "subnet-1",
				type: "aws_subnet",
				config: { cidrBlock: "10.0.1.0/24" },
			},
			{ id: "sg-1", type: "aws_security_group", config: {} },
			{ id: "web-1", type: "aws_ec2", config: {} },
			{ id: "repo-1", type: "aws_ecr", config: {} },
			{ id: "role-1", type: "aws_iam_role", config: {} },
			{ id: "fn-1", type: "aws_lambda", config: {} },
			{ id: "api-1", type: "aws_apigateway", config: {} },
		],
		edges: [
			{ source: "subnet-1", target: "vpc-1" },
			{ source: "sg-1", target: "vpc-1" },
			{ source: "web-1", target: "vpc-1" },
			{ source: "web-1", target: "subnet-1" },
			{ source: "web-1", target: "sg-1" },
			{ source: "repo-1", target: "vpc-1" },
			{ source: "role-1", target: "vpc-1" },
			{ source: "fn-1", target: "vpc-1" },
			{ source: "fn-1", target: "role-1" },
			{ source: "fn-1", target: "repo-1" },
			{ source: "api-1", target: "vpc-1" },
			{ source: "api-1", target: "fn-1" },
		],
	};
}

function deployGraph(): Record<string, unknown> {
	return {
		version: 1,
		name: "deploy-stack",
		nodes: [
			{ id: "vpc-1", type: "aws_vpc", config: { cidrBlock: "10.0.0.0/16" } },
			{
				id: "subnet-1",
				type: "aws_subnet",
				config: { cidrBlock: "10.0.1.0/24" },
			},
			{ id: "sg-1", type: "aws_security_group", config: {} },
			{ id: "web-1", type: "aws_ec2", config: {} },
		],
		edges: [
			{ source: "subnet-1", target: "vpc-1" },
			{ source: "sg-1", target: "vpc-1" },
			{ source: "web-1", target: "vpc-1" },
			{ source: "web-1", target: "subnet-1" },
			{ source: "web-1", target: "sg-1" },
		],
	};
}

interface DeploymentDoc {
	_id: unknown;
	status: string;
	action: string;
	planSummary?: {
		create: number;
		update: number;
		destroy: number;
		resources: Array<{ address: string; action: string }>;
	};
	events: Array<{ level: string; message: string; at: string }>;
	completedAt?: string;
}

let app: Hono<AppEnv>;
let realAuthApp: Hono<AppEnv>;
let deploymentModel: {
	findById(id: string): { lean(): Promise<DeploymentDoc | null> };
	updateOne(filter: unknown, update: unknown): Promise<unknown>;
};

async function request(
	handler: Hono<AppEnv>,
	method: string,
	path: string,
	body?: unknown,
): Promise<Response> {
	return await handler.request(path, {
		method,
		headers:
			body === undefined ? undefined : { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

async function json(res: Response): Promise<Record<string, unknown>> {
	return (await res.json()) as Record<string, unknown>;
}

function mockPlanSummary(resourceCount: number, destroy: boolean) {
	return {
		create: destroy ? 0 : resourceCount,
		update: 0,
		destroy: destroy ? resourceCount : 0,
		resources: Array.from({ length: resourceCount }, (_, i) => ({
			address: `aws_instance.web-${i + 1}`,
			action: destroy ? "delete" : "create",
		})),
	};
}

async function simulatePlan(
	deploymentId: string,
	resourceCount = 4,
	destroy = false,
) {
	const now = new Date();
	await deploymentModel.updateOne(
		{ _id: deploymentId },
		{
			$set: {
				status: "awaiting_approval",
				planSummary: mockPlanSummary(resourceCount, destroy),
				updatedAt: now,
			},
			$push: {
				events: {
					$each: [
						{
							at: now,
							level: "success",
							message: destroy ? "Destruction plan ready" : "Plan ready",
						},
					],
				},
			},
		},
	);
}

async function simulateApply(deploymentId: string) {
	const now = new Date();
	await deploymentModel.updateOne(
		{ _id: deploymentId },
		{
			$set: { status: "completed", completedAt: now, updatedAt: now },
			$push: {
				events: {
					$each: [
						{ at: now, level: "success", message: "Apply complete (mock)" },
					],
				},
			},
		},
	);
}

beforeAll(async () => {
	const db = await import("@my-better-t-app/db");
	const queue = await import("@my-better-t-app/queue");

	deploymentModel = db.Deployment as never;

	const dbClient = await db.getClient();
	await dbClient.dropDatabase();
	await queue.getPlanQueue().obliterate({ force: true });
	await queue.getApplyQueue().obliterate({ force: true });

	const { createApp } = await import("../app");
	app = createApp({
		authMiddleware: async (c, next) => {
			c.set("userId", TEST_USER_ID);
			await next();
		},
		disableLogging: true,
	});
	realAuthApp = createApp({ disableLogging: true });
});

describe("api health + auth", () => {
	test("GET /health reports ready", async () => {
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.ok).toBe(true);
		expect(body.service).toBe("cloudman-api");
	});

	test("unknown routes 404", async () => {
		const res = await app.request("/nope");
		expect(res.status).toBe(404);
	});

	test("protected routes fall back to the shared anonymous user", async () => {
		// Auth pass-through: without a session the request is still served,
		// scoped to a single shared workspace user instead of being rejected.
		const res = await realAuthApp.request("/api/projects");
		expect(res.status).toBe(200);
	});
});

describe("api compile preview", () => {
	test("compiles a catalog v2 graph into tofu files", async () => {
		const res = await request(app, "POST", "/api/compile", {
			graph: validGraph(),
			region: "us-east-1",
			bucketNameSuffix: "ab12cd34",
		});
		expect(res.status).toBe(200);
		const body = await json(res);
		const files = body.files as Array<{ path: string; contents: string }>;
		const main = files.find((f) => f.path === "main.tf")?.contents ?? "";
		expect((body.stats as { resources: number }).resources).toBe(8);
		expect(main).toContain('resource "aws_ecr_repository" "repo-1"');
		expect(main).toContain('resource "aws_lambda_function" "fn-1"');
		expect(main).toContain('resource "aws_api_gateway_rest_api" "api-1"');
		expect(main).toContain('resource "aws_instance" "web-1"');
	});

	test("returns a CloudFormation export that mirrors the tofu graph", async () => {
		const res = await request(app, "POST", "/api/compile", {
			graph: validGraph(),
			region: "us-east-1",
			bucketNameSuffix: "ab12cd34",
		});
		expect(res.status).toBe(200);
		const body = (await json(res)) as unknown as {
			cloudFormation: string;
		};
		const parsed = JSON.parse(body.cloudFormation) as {
			Resources: Record<string, { Type: string; DependsOn?: string[] }>;
		};
		const types = Object.values(parsed.Resources).map((r) => r.Type);
		expect(types).toContain("AWS::EC2::Instance");
		expect(types).toContain("AWS::ECR::Repository");
		expect(types).toContain("AWS::Lambda::Function");
		expect(types).toContain("AWS::ApiGateway::RestApi");
		const ec2 = Object.entries(parsed.Resources).find(([, r]) => {
			return r.Type === "AWS::EC2::Instance";
		});
		expect(ec2?.[1].DependsOn?.length).toBeGreaterThan(0);
	});

	test("returns a cost estimate and risk review alongside files", async () => {
		const res = await request(app, "POST", "/api/compile", {
			graph: validGraph(),
			region: "us-east-1",
		});
		expect(res.status).toBe(200);
		const body = (await json(res)) as unknown as {
			cost: {
				monthlyTotal: number;
				resources: Array<{ irId: string; monthly: number }>;
				topSpenders: string[];
			};
			risks: Array<{ code: string; severity: string }>;
		};
		expect(body.cost.resources).toHaveLength(8);
		expect(body.cost.monthlyTotal).toBeCloseTo(0.0104 * 730 + 8 * 0.08, 2);
		expect(body.cost.topSpenders).toContain("web-1");
		expect(Array.isArray(body.risks)).toBe(true);
	});

	test("emits record values for route53 records with a records list", async () => {
		const res = await request(app, "POST", "/api/compile", {
			graph: {
				version: 1,
				name: "dns-stack",
				nodes: [
					{
						id: "zone-1",
						type: "aws_route53_zone",
						config: { zoneName: "example.com" },
					},
					{
						id: "rec-1",
						type: "aws_route53_record",
						config: {
							recordName: "api",
							recordType: "A",
							ttl: 300,
							records: ["203.0.113.10"],
						},
					},
				],
				edges: [{ source: "rec-1", target: "zone-1" }],
			},
			region: "us-east-1",
		});
		expect(res.status).toBe(200);
		const body = (await json(res)) as unknown as {
			files: Array<{ path: string; contents: string }>;
		};
		const main = body.files.find((f) => f.path === "main.tf")?.contents ?? "";
		expect(main).toContain('resource "aws_route53_record" "rec-1"');
		expect(main).toContain('records = ["203.0.113.10"]');
	});

	test("surfaces cost and security warnings as risks", async () => {
		const graph = {
			version: 1,
			name: "risky-stack",
			nodes: [
				{ id: "vpc-1", type: "aws_vpc", config: { cidrBlock: "10.0.0.0/16" } },
				{
					id: "subnet-1",
					type: "aws_subnet",
					config: { cidrBlock: "10.0.1.0/24" },
				},
				{ id: "nat-1", type: "aws_nat_gateway", config: {} },
				{ id: "bucket-1", type: "aws_s3", config: { versioning: false } },
			],
			edges: [
				{ source: "subnet-1", target: "vpc-1" },
				{ source: "nat-1", target: "subnet-1" },
			],
		};
		const res = await request(app, "POST", "/api/compile", { graph });
		expect(res.status).toBe(200);
		const body = (await json(res)) as unknown as {
			risks: Array<{ code: string }>;
		};
		const codes = body.risks.map((r) => r.code);
		expect(codes).toContain("S3_NO_VERSIONING");
		expect(codes).toContain("NAT_COST_HOTSPOT");
	});

	test("rejects an invalid graph with 422", async () => {
		const graph = validGraph();
		(graph.nodes as Array<Record<string, unknown>>).push({
			id: "db-1",
			type: "aws_rds",
			config: {},
		});
		(graph.edges as Array<Record<string, unknown>>).push({
			source: "db-1",
			target: "subnet-1",
		});
		const res = await request(app, "POST", "/api/compile", { graph });
		expect(res.status).toBe(422);
	});
});

describe("api generate (blueprints)", () => {
	test("generates an engine stack from a prompt and round-trips through compile", async () => {
		const res = await request(app, "POST", "/api/generate", {
			prompt: "serverless api with lambda",
		});
		expect(res.status).toBe(200);
		const body = (await json(res)) as unknown as {
			blueprint: string;
			mode: string;
			graph: { nodes: Array<{ type: string }> };
			warnings: string[];
		};
		expect(body.mode).toBe("engine");
		expect(body.blueprint).toBe("serverless-api");
		expect(body.graph.nodes.some((n) => n.type === "aws_lambda")).toBe(true);
		expect(body.warnings.length).toBeGreaterThan(0);

		const compiled = await request(app, "POST", "/api/compile", {
			graph: body.graph,
		});
		expect(compiled.status).toBe(200);
	});

	test("rejects a too-short or too-long prompt", async () => {
		const short = await request(app, "POST", "/api/generate", { prompt: "ab" });
		expect(short.status).toBe(400);
		const long = await request(app, "POST", "/api/generate", {
			prompt: "x".repeat(501),
		});
		expect(long.status).toBe(400);
	});

	test("lists blueprint templates including the react-app template", async () => {
		const res = await request(app, "GET", "/api/blueprints");
		expect(res.status).toBe(200);
		const body = (await json(res)) as unknown as {
			blueprints: Array<{ id: string; name: string }>;
		};
		const ids = body.blueprints.map((b) => b.id);
		expect(ids).toContain("react-app");
		expect(ids).toContain("web-app");
		expect(ids).toContain("serverless-api");
		expect(ids).toContain("data-pipeline");
	});

	test("loads the react-app template graph by id and compiles", async () => {
		const res = await request(app, "GET", "/api/blueprints/react-app");
		expect(res.status).toBe(200);
		const body = (await json(res)) as unknown as {
			blueprint: string;
			graph: { nodes: Array<{ type: string }>; edges: unknown[] };
		};
		expect(body.blueprint).toBe("react-app");
		const types = body.graph.nodes.map((n) => n.type);
		expect(types).toContain("aws_ecs");
		expect(types).toContain("aws_alb");
		expect(types).toContain("aws_ecr");
		expect(body.graph.edges.length).toBeGreaterThan(0);

		const compiled = await request(app, "POST", "/api/compile", {
			graph: body.graph,
		});
		expect(compiled.status).toBe(200);
	});

	test("returns 404 for an unknown blueprint id", async () => {
		const res = await request(app, "GET", "/api/blueprints/nope");
		expect(res.status).toBe(404);
	});
});

describe("api analytics", () => {
	test("reports safe aggregates that track seeded deployments", async () => {
		const db = await import("@my-better-t-app/db");
		const beforeBody = (await json(
			await request(app, "GET", "/api/analytics"),
		)) as unknown as {
			stats: {
				projects: number;
				deployments: number;
				completed: number;
				failed: number;
				successRate: number | null;
				resourcesManaged: number;
				monthlySpendEstimate: number;
			};
		};
		const before = beforeBody.stats;

		const created = (await json(
			await request(app, "POST", "/api/projects", { name: "analytics-probe" }),
		)) as { project: { _id: string } };
		const projectId = created.project._id;

		await db.Deployment.insertMany([
			{
				projectId,
				graphVersionId: "640000000000000000000000",
				status: "completed",
				action: "provision",
				planSummary: { create: 3, update: 1, destroy: 0, resources: [] },
				estimatedMonthlyCost: 12.34,
				completedAt: new Date(),
			},
			{
				projectId,
				graphVersionId: "640000000000000000000001",
				status: "failed",
				action: "provision",
				planSummary: { create: 2, update: 0, destroy: 0, resources: [] },
				error: "plan failed",
			},
		]);

		const after = (await json(
			await request(app, "GET", "/api/analytics"),
		)) as typeof beforeBody;
		expect(after.stats.projects).toBe(before.projects + 1);
		expect(after.stats.deployments).toBe(before.deployments + 2);
		expect(after.stats.completed).toBe(before.completed + 1);
		expect(after.stats.failed).toBe(before.failed + 1);
		expect(after.stats.resourcesManaged).toBe(before.resourcesManaged + 4);
		const settled = after.stats.completed + after.stats.failed;
		expect(after.stats.successRate).toBe(
			settled === 0
				? null
				: Math.round((after.stats.completed / settled) * 100),
		);
		expect(after.stats.monthlySpendEstimate).toBeCloseTo(
			before.monthlySpendEstimate + 12.34,
			2,
		);
	});
});

describe("api projects + graph versions", () => {
	test("creates, lists, gets, saves graphs, and deletes projects", async () => {
		const created = await request(app, "POST", "/api/projects", {
			name: "spike",
			description: "e2e",
		});
		expect(created.status).toBe(201);
		const { project } = (await json(created)) as { project: { _id: string } };

		const list = await json(await request(app, "GET", "/api/projects"));
		expect(
			(list.projects as Array<{ _id: string }>).some(
				(p) => p._id === project._id,
			),
		).toBe(true);

		const single = await json(
			await request(app, "GET", `/api/projects/${project._id}`),
		);
		expect((single.project as { _id: string })._id).toBe(project._id);

		const updated = await request(
			app,
			"PUT",
			`/api/projects/${project._id}/graph`,
			{ graph: deployGraph() },
		);
		expect(updated.status).toBe(201);
		const { version } = (await json(updated)) as { version: number };
		expect(version).toBe(1);

		const latest = await json(
			await request(app, "GET", `/api/projects/${project._id}/graph/latest`),
		);
		expect((latest.graphVersion as { version: number }).version).toBe(1);

		const gone = await request(app, "DELETE", `/api/projects/${project._id}`);
		expect(gone.status).toBe(200);
	});

	test("lists saved graph versions and fetches a specific one", async () => {
		const created = await request(app, "POST", "/api/projects", {
			name: "versions",
		});
		const { project } = (await json(created)) as { project: { _id: string } };
		await request(app, "PUT", `/api/projects/${project._id}/graph`, {
			graph: deployGraph(),
		});

		const listed = await json(
			await request(app, "GET", `/api/projects/${project._id}/graphs`),
		);
		const versions = listed.versions as Array<{ version: number }>;
		expect(versions.length).toBe(1);
		expect(versions[0]?.version).toBe(1);

		const fetched = await json(
			await request(app, "GET", `/api/projects/${project._id}/graphs/1`),
		);
		const graphVersion = fetched.graphVersion as {
			version: number;
			graph: { nodes: unknown[] };
		};
		expect(graphVersion.version).toBe(1);
		expect(graphVersion.graph.nodes.length).toBe(4);

		const missing = await json(
			await request(app, "GET", `/api/projects/${project._id}/graphs/99`),
		);
		expect(missing.graphVersion).toBeNull();

		const bad = await request(
			app,
			"GET",
			`/api/projects/${project._id}/graphs/not-a-number`,
		);
		expect(bad.status).toBe(400);
	});

	test("rejects an invalid graph save", async () => {
		const created = await request(app, "POST", "/api/projects", {
			name: "bad-graph",
		});
		const { project } = (await json(created)) as { project: { _id: string } };
		const res = await request(
			app,
			"PUT",
			`/api/projects/${project._id}/graph`,
			{
				graph: {
					version: 1,
					name: "x",
					nodes: [{ id: "bogus-1", type: "aws_fjord", config: {} }],
					edges: [],
				},
			},
		);
		expect(res.status).toBe(422);
	});

	test("unknown project ids 404", async () => {
		const res = await request(
			app,
			"GET",
			"/api/projects/000000000000000000000000",
		);
		expect(res.status).toBe(404);
	});
});

describe("api project updates", () => {
	test("renames and edits a project description", async () => {
		const created = await request(app, "POST", "/api/projects", {
			name: "rename-me",
			description: "before",
		});
		const { project } = (await json(created)) as { project: { _id: string } };

		const patched = await request(app, "PUT", `/api/projects/${project._id}`, {
			name: "renamed",
			description: "after",
		});
		expect(patched.status).toBe(200);
		const body = (await json(patched)) as {
			project: { name: string; description: string };
		};
		expect(body.project.name).toBe("renamed");
		expect(body.project.description).toBe("after");
	});

	test("partial update only touches the given field", async () => {
		const created = await request(app, "POST", "/api/projects", {
			name: "partial",
			description: "keep-me",
		});
		const { project } = (await json(created)) as { project: { _id: string } };

		const patched = await request(app, "PUT", `/api/projects/${project._id}`, {
			name: "partial-2",
		});
		expect(patched.status).toBe(200);
		const body = (await json(patched)) as {
			project: { name: string; description: string };
		};
		expect(body.project.name).toBe("partial-2");
		expect(body.project.description).toBe("keep-me");
	});

	test("rejects empty and invalid update bodies", async () => {
		const created = await request(app, "POST", "/api/projects", {
			name: "noop",
		});
		const { project } = (await json(created)) as { project: { _id: string } };

		const empty = await request(app, "PUT", `/api/projects/${project._id}`, {});
		expect(empty.status).toBe(400);

		const invalid = await request(app, "PUT", `/api/projects/${project._id}`, {
			name: "",
		});
		expect(invalid.status).toBe(400);
	});

	test("cannot update another user's project", async () => {
		const res = await request(
			app,
			"PUT",
			"/api/projects/000000000000000000000000",
			{ name: "nope" },
		);
		expect(res.status).toBe(404);
	});
});

describe("api aws-connections", () => {
	test("creates, lists, deletes, and verifies connections", async () => {
		const created = await request(app, "POST", "/api/aws-connections", {
			label: "prod",
			roleArn: "arn:aws:iam::123456789012:role/CloudManDeploy",
			externalId: "external-abc-123",
			region: "us-east-1",
		});
		expect(created.status).toBe(201);
		const { connection } = (await json(created)) as {
			connection: { _id: string; roleArn: string; externalId?: string };
		};
		expect(connection.roleArn).toContain("123456789012");
		expect(connection.externalId).toBeUndefined();

		const list = await json(await request(app, "GET", "/api/aws-connections"));
		expect((list.connections as unknown[]).length).toBe(1);

		const removed = await request(
			app,
			"DELETE",
			`/api/aws-connections/${connection._id}`,
		);
		expect(removed.status).toBe(200);
	});

	test("verifies against invalid credentials as 502 without touching infra", async () => {
		const created = await request(app, "POST", "/api/aws-connections", {
			label: "bad",
			roleArn: "arn:aws:iam::123456789012:role/NoSuchRole",
			externalId: "external-abc-123",
		});
		const { connection } = (await json(created)) as {
			connection: { _id: string };
		};
		const res = await request(
			app,
			"POST",
			`/api/aws-connections/${connection._id}/verify`,
		);
		expect(res.status).toBe(502);
	});
});

describe("api deployment lifecycle (mock worker)", () => {
	test("provision → plan → approve → apply → completed", async () => {
		const created = await request(app, "POST", "/api/projects", {
			name: "deploy-flow",
		});
		const { project } = (await json(created)) as { project: { _id: string } };
		await request(app, "PUT", `/api/projects/${project._id}/graph`, {
			graph: deployGraph(),
		});

		const queued = await request(
			app,
			"POST",
			`/api/projects/${project._id}/deployments`,
			{ action: "provision", region: "us-east-1" },
		);
		expect(queued.status).toBe(201);
		const { deployment } = (await json(queued)) as {
			deployment: { _id: string; status: string };
		};
		expect(deployment.status).toBe("queued");

		await simulatePlan(deployment._id);

		const planned = await deploymentModel.findById(deployment._id).lean();
		expect(planned?.status).toBe("awaiting_approval");
		expect(planned?.planSummary?.create).toBe(4);
		expect(planned?.events.at(-1)?.message).toContain("Plan ready");

		const approved = await request(
			app,
			"POST",
			`/api/deployments/${deployment._id}/approve`,
		);
		expect(approved.status).toBe(200);

		const applyQueued = await deploymentModel.findById(deployment._id).lean();
		expect(applyQueued?.status).toBe("apply_queued");

		await simulateApply(deployment._id);

		const done = await deploymentModel.findById(deployment._id).lean();
		expect(done?.status).toBe("completed");
		expect(done?.completedAt).toBeDefined();
		expect(done?.events.at(-1)?.message).toContain("Apply complete");
	});

	test("cannot approve a deployment that is not awaiting approval", async () => {
		const created = await request(app, "POST", "/api/projects", {
			name: "no-approve",
		});
		const { project } = (await json(created)) as { project: { _id: string } };
		await request(app, "PUT", `/api/projects/${project._id}/graph`, {
			graph: deployGraph(),
		});
		const queued = await request(
			app,
			"POST",
			`/api/projects/${project._id}/deployments`,
			{},
		);
		const { deployment } = (await json(queued)) as {
			deployment: { _id: string };
		};
		const res = await request(
			app,
			"POST",
			`/api/deployments/${deployment._id}/approve`,
		);
		expect(res.status).toBe(409);
	});

	test("can cancel a queued deployment and repeated cancel is guarded", async () => {
		const created = await request(app, "POST", "/api/projects", {
			name: "cancel-flow",
		});
		const { project } = (await json(created)) as { project: { _id: string } };
		await request(app, "PUT", `/api/projects/${project._id}/graph`, {
			graph: deployGraph(),
		});
		const queued = await request(
			app,
			"POST",
			`/api/projects/${project._id}/deployments`,
			{},
		);
		const { deployment } = (await json(queued)) as {
			deployment: { _id: string };
		};

		const canceled = await request(
			app,
			"POST",
			`/api/deployments/${deployment._id}/cancel`,
		);
		expect(canceled.status).toBe(200);
		expect(((await json(canceled)) as { status: string }).status).toBe(
			"canceled",
		);

		const again = await request(
			app,
			"POST",
			`/api/deployments/${deployment._id}/cancel`,
		);
		expect(again.status).toBe(409);
	});

	test("retry requeues a failed deployment", async () => {
		const created = await request(app, "POST", "/api/projects", {
			name: "retry-flow",
		});
		const { project } = (await json(created)) as { project: { _id: string } };
		await request(app, "PUT", `/api/projects/${project._id}/graph`, {
			graph: deployGraph(),
		});
		const queued = await request(
			app,
			"POST",
			`/api/projects/${project._id}/deployments`,
			{},
		);
		const { deployment } = (await json(queued)) as {
			deployment: { _id: string };
		};

		const retryBeforeFail = await request(
			app,
			"POST",
			`/api/deployments/${deployment._id}/retry`,
		);
		expect(retryBeforeFail.status).toBe(409);

		const now = new Date();
		await deploymentModel.updateOne(
			{ _id: deployment._id },
			{
				$set: { status: "failed", updatedAt: now },
				$push: {
					events: {
						$each: [{ at: now, level: "error", message: "Plan failed (mock)" }],
					},
				},
			},
		);

		const retried = await request(
			app,
			"POST",
			`/api/deployments/${deployment._id}/retry`,
		);
		expect(retried.status).toBe(200);
		expect(((await json(retried)) as { status: string }).status).toBe("queued");

		const retriedDoc = await deploymentModel.findById(deployment._id).lean();
		expect(retriedDoc?.status).toBe("queued");
	});

	test("destroy pins the last completed provision and allows project deletion", async () => {
		const created = await request(app, "POST", "/api/projects", {
			name: "destroy-flow",
		});
		const { project } = (await json(created)) as { project: { _id: string } };
		await request(app, "PUT", `/api/projects/${project._id}/graph`, {
			graph: deployGraph(),
		});

		const queued = await request(
			app,
			"POST",
			`/api/projects/${project._id}/deployments`,
			{ action: "provision" },
		);
		const { deployment } = (await json(queued)) as {
			deployment: { _id: string };
		};
		await simulatePlan(deployment._id);
		await request(app, "POST", `/api/deployments/${deployment._id}/approve`);
		await simulateApply(deployment._id);

		const destroyQueued = await request(
			app,
			"POST",
			`/api/projects/${project._id}/deployments`,
			{ action: "destroy" },
		);
		expect(destroyQueued.status).toBe(201);
		const { deployment: destroyDeployment } = (await json(destroyQueued)) as {
			deployment: { _id: string };
		};
		await simulatePlan(destroyDeployment._id, 4, true);

		const destroyPlanned = await deploymentModel
			.findById(destroyDeployment._id)
			.lean();
		expect(destroyPlanned?.status).toBe("awaiting_approval");
		expect(destroyPlanned?.planSummary?.destroy).toBe(4);
		expect(destroyPlanned?.planSummary?.create).toBe(0);

		await request(
			app,
			"POST",
			`/api/deployments/${destroyDeployment._id}/approve`,
		);
		await simulateApply(destroyDeployment._id);

		const destroyed = await deploymentModel
			.findById(destroyDeployment._id)
			.lean();
		expect(destroyed?.status).toBe("completed");

		const removed = await request(
			app,
			"DELETE",
			`/api/projects/${project._id}`,
		);
		expect(removed.status).toBe(200);
	});

	test("refuses destroy when nothing was ever deployed", async () => {
		const created = await request(app, "POST", "/api/projects", {
			name: "never-deployed",
		});
		const { project } = (await json(created)) as { project: { _id: string } };
		const res = await request(
			app,
			"POST",
			`/api/projects/${project._id}/deployments`,
			{ action: "destroy" },
		);
		expect(res.status).toBe(409);
	});

	test("guarded project deletion while a deployment is in flight", async () => {
		const created = await request(app, "POST", "/api/projects", {
			name: "in-flight",
		});
		const { project } = (await json(created)) as { project: { _id: string } };
		await request(app, "PUT", `/api/projects/${project._id}/graph`, {
			graph: deployGraph(),
		});
		await request(app, "POST", `/api/projects/${project._id}/deployments`, {});

		const res = await request(app, "DELETE", `/api/projects/${project._id}`);
		expect(res.status).toBe(409);
	});

	test("deletes a project despite a never-approved plan and cancels it", async () => {
		const created = await request(app, "POST", "/api/projects", {
			name: "stuck-plan",
		});
		const { project } = (await json(created)) as { project: { _id: string } };
		await request(app, "PUT", `/api/projects/${project._id}/graph`, {
			graph: deployGraph(),
		});
		const deployment = await request(
			app,
			"POST",
			`/api/projects/${project._id}/deployments`,
			{},
		);
		const body = (await json(deployment)) as {
			deployment: { _id: string };
		};
		// A plan that reaches awaiting_approval was never applied — it must not
		// permanently block deletion.
		await deploymentModel.updateOne(
			{ _id: body.deployment._id },
			{ $set: { status: "awaiting_approval" } },
		);

		const res = await request(app, "DELETE", `/api/projects/${project._id}`);
		expect(res.status).toBe(200);

		// Awaiting-approval plans are never applied; deletion must succeed and
		// remove the pending deployment along with the project.
		const leftover = await deploymentModel.findById(body.deployment._id).lean();
		expect(leftover).toBeNull();
	});

	test("deletes a project with a stale orphaned deploying deployment", async () => {
		const created = await request(app, "POST", "/api/projects", {
			name: "stale-orphan",
		});
		const { project } = (await json(created)) as { project: { _id: string } };
		await request(app, "PUT", `/api/projects/${project._id}/graph`, {
			graph: deployGraph(),
		});
		const deployment = await request(
			app,
			"POST",
			`/api/projects/${project._id}/deployments`,
			{},
		);
		const body = (await json(deployment)) as {
			deployment: { _id: string };
		};
		// Simulate a worker that died mid-init: status stuck but the document was
		// last updated more than an hour ago, so nothing is actually executing.
		await deploymentModel.updateOne(
			{ _id: body.deployment._id },
			{
				$set: {
					status: "initializing",
					updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
				},
			},
		);

		const res = await request(app, "DELETE", `/api/projects/${project._id}`);
		expect(res.status).toBe(200);
	});
});
