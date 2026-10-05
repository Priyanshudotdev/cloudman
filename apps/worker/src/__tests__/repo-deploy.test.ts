import { beforeAll, describe, expect, test } from "bun:test";

// Mock-mode repo deploy tests — mirror mock-jobs.test.ts env so the worker
// takes the simulated git/ssh branch (no real clone or SSH in tests).
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

import type { RepoJobData } from "@my-better-t-app/queue";
import type { Job } from "bullmq";

const TEST_USER_ID = "64b000000000000000000001";

function fakeRepoJob(deploymentId: string): Job<RepoJobData> {
	return { data: { deploymentId } } as unknown as Job<RepoJobData>;
}

let deploymentModel: {
	findById(id: string): { lean(): Promise<any | null> };
	updateOne(filter: unknown, update: unknown): Promise<unknown>;
};
let createRepoProject: (serverId?: unknown) => Promise<{ _id: unknown }>;
let createServer: () => Promise<{ _id: unknown }>;
let createRepoDeployment: (
	projectId: unknown,
	serverId: unknown,
	opts?: Partial<{ status: string }>,
) => Promise<{ _id: unknown }>;
let handleRepoDeployJob: (job: Job<RepoJobData>) => Promise<void>;

beforeAll(async () => {
	const db = await import("@my-better-t-app/db");
	await db.getClient();

	deploymentModel = db.Deployment as never;
	createServer = async () =>
		db.Server.create({
			userId: TEST_USER_ID,
			label: "repo-test-" + String(Date.now()),
			host: "203.0.113.10",
			port: 22,
			sshUser: "root",
			authMode: "key",
			credentialEnc: "test-key-plaintext",
			remoteAppDir: "/srv/cloudman",
		});
	createRepoProject = async (serverId) =>
		db.Project.create({
			name: "r-" + String(Date.now()),
			ownerUserId: TEST_USER_ID,
			kind: "repo",
			repo: {
				url: "https://github.com/org/app.git",
				branch: "main",
				defaultStack: "node-express",
				...(serverId ? { serverId } : {}),
			},
		});
	createRepoDeployment = async (projectId, serverId, opts = {}) =>
		db.Deployment.create({
			projectId,
			serverId,
			kind: "repo",
			action: "provision",
			status: opts.status ?? "queued",
		});

	const mod = await import("../jobs/repo-deploy");
	handleRepoDeployJob = mod.handleRepoDeployJob;
});

describe("worker repo-deploy job (mock)", () => {
	test("completes a queued repo deploy with url and summary", async () => {
		const server = await createServer();
		const project = await createRepoProject(server._id);
		const deployment = await createRepoDeployment(project._id, server._id);

		await handleRepoDeployJob(fakeRepoJob(String(deployment._id)));

		const after = await deploymentModel.findById(String(deployment._id)).lean();
		expect(after?.status).toBe("completed");
		expect(after?.url).toContain("http://203.0.113.10:");
		expect(after?.repoPlanSummary?.artifacts?.length).toBeGreaterThan(0);
		expect(after?.repoPlanSummary?.changed).toEqual([]);
		expect(after?.commitSha).toBe("mock-sha");
		expect(after?.events.at(-1)?.message).toContain("Repo deploy complete");
	});

	test("skips when the deployment is no longer queued", async () => {
		const server = await createServer();
		const project = await createRepoProject(server._id);
		const deployment = await createRepoDeployment(project._id, server._id, {
			status: "canceled",
		});

		await handleRepoDeployJob(fakeRepoJob(String(deployment._id)));

		const after = await deploymentModel.findById(String(deployment._id)).lean();
		expect(after?.status).toBe("canceled");
	});

	test("fails fast when the deployment is missing", async () => {
		const missing = "000000000000000000000000";
		await expect(handleRepoDeployJob(fakeRepoJob(missing))).rejects.toThrow();
	});
});
