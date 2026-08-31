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

	await db.client.dropDatabase();
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

	test("protected routes reject anonymous users", async () => {
		const res = await realAuthApp.request("/api/projects");
		expect(res.status).toBe(401);
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
});
