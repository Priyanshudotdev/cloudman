import { beforeAll, describe, expect, test } from "bun:test";

// Separate DB from the api e2e suite (which drops cloudman_test in beforeAll)
// so `turbo run test` can run both suites in parallel without clobbering.
process.env.DATABASE_URL = "mongodb://127.0.0.1:27017/cloudman_test_worker";
process.env.REDIS_URL = "redis://127.0.0.1:6379/14";
process.env.NODE_ENV = "test";
process.env.CLOUDMAN_WORKER_MOCK = "1";
process.env.CLOUDMAN_REMOTE_STATE = "0";
process.env.CLOUDMAN_SECRET = "ab".repeat(32);
process.env.AWS_REGION = "us-east-1";

const originalGetBuiltinModule: (id: string) => NodeJS.Module | undefined =
	// biome-ignore lint/style/noNonNullAssertion: process prod isn't pre-patched
	process.getBuiltinModule!;
process.getBuiltinModule = (id: string) =>
	// bson 7 calls node:v8 startupSnapshot.isBuildingSnapshot() at import time,
	// which Bun throws NotImplementedError on. Return undefined so bson's `?? {}`
	// fallback skips the branch.
	id === "v8" ? undefined : originalGetBuiltinModule(id);

import type {
	InfraApplyJobData,
	InfraPlanJobData,
} from "@my-better-t-app/queue";
import type { Job } from "bullmq";

const TEST_USER_ID = "64b000000000000000000001";

function deployGraph(): Record<string, unknown> {
	return {
		version: 1,
		name: "worker-stack",
		nodes: [
			{ id: "vpc-1", type: "aws_vpc", config: { cidrBlock: "10.0.0.0/16" } },
			{
				id: "subnet-1",
				type: "aws_subnet",
				config: { cidrBlock: "10.0.1.0/24" },
			},
		],
		edges: [{ source: "subnet-1", target: "vpc-1" }],
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

function fakePlanJob(deploymentId: string): Job<InfraPlanJobData> {
	return { data: { deploymentId } } as unknown as Job<InfraPlanJobData>;
}

function fakeApplyJob(deploymentId: string): Job<InfraApplyJobData> {
	return { data: { deploymentId } } as unknown as Job<InfraApplyJobData>;
}

let deploymentModel: {
	findById(id: string): { lean(): Promise<DeploymentDoc | null> };
	updateOne(filter: unknown, update: unknown): Promise<unknown>;
};
let createProject: () => Promise<{ _id: unknown }>;
let createGraphVersion: (projectId: unknown) => Promise<{ _id: unknown }>;
let createDeployment: (
	projectId: unknown,
	graphVersionId: unknown,
	opts?: Partial<{ action: "provision" | "destroy"; status: string }>,
) => Promise<{ _id: unknown }>;
let handlePlanJob: (job: Job<InfraPlanJobData>) => Promise<void>;
let handleApplyJob: (job: Job<InfraApplyJobData>) => Promise<void>;

async function queueApply(deploymentId: string) {
	await deploymentModel.updateOne(
		{ _id: deploymentId },
		{ $set: { status: "apply_queued" } },
	);
}

beforeAll(async () => {
	const db = await import("@my-better-t-app/db");

	deploymentModel = db.Deployment as never;
	createProject = async () =>
		db.Project.create({ name: `w-${Date.now()}`, ownerUserId: TEST_USER_ID });
	createGraphVersion = async (projectId) =>
		db.GraphVersion.create({ projectId, version: 1, graph: deployGraph() });
	createDeployment = async (projectId, graphVersionId, opts = {}) =>
		db.Deployment.create({
			projectId,
			graphVersionId,
			action: opts.action ?? "provision",
			status: opts.status ?? "queued",
		});

	const plan = await import("../jobs/plan");
	const apply = await import("../jobs/apply");
	handlePlanJob = plan.handlePlanJob;
	handleApplyJob = apply.handleApplyJob;
});

describe("worker plan job (mock)", () => {
	test("plans a queued provision and waits for approval", async () => {
		const project = await createProject();
		const graphVersion = await createGraphVersion(project._id);
		const deployment = await createDeployment(project._id, graphVersion._id);

		await handlePlanJob(fakePlanJob(String(deployment._id)));

		const after = await deploymentModel.findById(String(deployment._id)).lean();
		expect(after?.status).toBe("awaiting_approval");
		expect(after?.planSummary?.create).toBe(2);
		expect(after?.planSummary?.destroy).toBe(0);
		expect(after?.events.at(-1)?.message).toContain("Plan ready");
	});

	test("plans a destroy with zero creates", async () => {
		const project = await createProject();
		const graphVersion = await createGraphVersion(project._id);
		const deployment = await createDeployment(project._id, graphVersion._id, {
			action: "destroy",
		});

		await handlePlanJob(fakePlanJob(String(deployment._id)));

		const after = await deploymentModel.findById(String(deployment._id)).lean();
		expect(after?.status).toBe("awaiting_approval");
		expect(after?.planSummary?.create).toBe(0);
		expect(after?.planSummary?.destroy).toBe(2);
		expect(after?.events.at(-1)?.message).toContain("DESTROYED");
	});

	test("skips planning when the deployment is no longer queued", async () => {
		const project = await createProject();
		const graphVersion = await createGraphVersion(project._id);
		const deployment = await createDeployment(project._id, graphVersion._id, {
			status: "canceled",
		});

		await handlePlanJob(fakePlanJob(String(deployment._id)));

		const after = await deploymentModel.findById(String(deployment._id)).lean();
		expect(after?.status).toBe("canceled");
	});

	test("fails fast when the deployment is missing", async () => {
		const missing = "000000000000000000000000";
		await expect(handlePlanJob(fakePlanJob(missing))).rejects.toThrow();
	});
});

describe("worker apply job (mock)", () => {
	async function plannedDeployment() {
		const project = await createProject();
		const graphVersion = await createGraphVersion(project._id);
		const deployment = await createDeployment(project._id, graphVersion._id);
		await handlePlanJob(fakePlanJob(String(deployment._id)));
		const after = await deploymentModel.findById(String(deployment._id)).lean();
		return { deployment, after };
	}

	test("applies a planned provision to completion", async () => {
		const { deployment, after } = await plannedDeployment();
		expect(after?.status).toBe("awaiting_approval");

		await queueApply(String(deployment._id));
		await handleApplyJob(fakeApplyJob(String(deployment._id)));

		const done = await deploymentModel.findById(String(deployment._id)).lean();
		expect(done?.status).toBe("completed");
		expect(done?.completedAt).toBeDefined();
		expect(done?.events.at(-1)?.message).toBe("Deployment complete.");
	});

	test("skips applying when the deployment is not apply_queued", async () => {
		const project = await createProject();
		const graphVersion = await createGraphVersion(project._id);
		const deployment = await createDeployment(project._id, graphVersion._id);

		await handleApplyJob(fakeApplyJob(String(deployment._id)));

		const after = await deploymentModel.findById(String(deployment._id)).lean();
		expect(after?.status).toBe("queued");
	});

	test("destroys infrastructure and completes", async () => {
		const project = await createProject();
		const graphVersion = await createGraphVersion(project._id);
		const provision = await createDeployment(project._id, graphVersion._id);
		await handlePlanJob(fakePlanJob(String(provision._id)));
		await queueApply(String(provision._id));
		await handleApplyJob(fakeApplyJob(String(provision._id)));

		const destroy = await createDeployment(project._id, graphVersion._id, {
			action: "destroy",
		});
		await handlePlanJob(fakePlanJob(String(destroy._id)));
		const planned = await deploymentModel.findById(String(destroy._id)).lean();
		expect(planned?.planSummary?.destroy).toBe(2);

		await queueApply(String(destroy._id));
		await handleApplyJob(fakeApplyJob(String(destroy._id)));
		const done = await deploymentModel.findById(String(destroy._id)).lean();
		expect(done?.status).toBe("completed");
		expect(done?.events.at(-1)?.message).toBe(
			"Infrastructure destroyed. All resources removed.",
		);
	}, 20000);

	test("fails fast when the deployment is missing", async () => {
		const missing = "000000000000000000000000";
		await expect(handleApplyJob(fakeApplyJob(missing))).rejects.toThrow();
	});
});
