import { Deployment, getClient } from "@my-better-t-app/db";
import { env } from "@my-better-t-app/env/worker";
import {
	INFRA_APPLY_QUEUE,
	INFRA_PLAN_QUEUE,
	type InfraApplyJobData,
	type InfraPlanJobData,
	MAINTENANCE_QUEUE,
	type MaintenanceJobData,
} from "@my-better-t-app/queue";
import { Worker } from "bullmq";
import Redis from "ioredis";

import { handleApplyJob } from "./jobs/apply";
import { handlePlanJob } from "./jobs/plan";
import { recordDeploymentEvent } from "./lib/events";
import { cleanupWorkspace } from "./lib/workspace";

/**
 * On boot no tofu process can be running (concurrency 1, single worker), so
 * deployments stuck in a mid-execution state are orphaned from a previous
 * crashed/stopped process — fail them explicitly so the UI never hangs.
 * Durable states are intentionally kept:
 *  - queued / apply_queued: their BullMQ jobs live in Redis and resume.
 *  - awaiting_approval: a human decision gate, valid indefinitely.
 */
async function reconcileOrphanedDeployments(): Promise<void> {
	const executionStatuses = ["initializing", "planning", "planned", "applying"];
	const stale = await Deployment.find({ status: { $in: executionStatuses } })
		.select("_id")
		.lean();
	if (stale.length === 0) return;
	console.log(`[worker] reconciling ${stale.length} orphaned deployment(s)`);
	for (const doc of stale) {
		await recordDeploymentEvent(
			String(doc._id),
			{
				level: "error",
				message:
					"Worker restarted while this deployment was in flight — marked as failed.",
			},
			"failed",
		);
	}
}

await getClient();

await reconcileOrphanedDeployments();

if (env.CLOUDMAN_WORKER_MOCK === "1") {
	console.log("[worker] MOCK MODE — tofu execution is simulated");
}

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const planWorker = new Worker<InfraPlanJobData>(
	INFRA_PLAN_QUEUE,
	handlePlanJob,
	{
		connection,
		concurrency: 1,
	},
);

const applyWorker = new Worker<InfraApplyJobData>(
	INFRA_APPLY_QUEUE,
	handleApplyJob,
	{
		connection,
		concurrency: 1,
	},
);

const maintenanceWorker = new Worker<MaintenanceJobData>(
	MAINTENANCE_QUEUE,
	async (job) => {
		if (job.data.kind === "cleanup-workspace") {
			await cleanupWorkspace(job.data.projectId);
			console.log(
				`[worker] workspace cleaned for project ${job.data.projectId}`,
			);
		}
	},
	{
		connection,
		concurrency: 1,
	},
);

for (const [name, worker] of [
	["plan", planWorker],
	["apply", applyWorker],
	["maintenance", maintenanceWorker],
] as const) {
	worker.on("completed", (job) =>
		console.log(`[worker] ${name} job ${job.id} completed`),
	);
	worker.on("failed", (job, error) =>
		console.error(`[worker] ${name} job ${job?.id} failed:`, error.message),
	);
}

console.log(
	`[worker] consuming queues "${INFRA_PLAN_QUEUE}" + "${INFRA_APPLY_QUEUE}"`,
);
console.log(`[worker] redis:      ${env.REDIS_URL}`);
console.log(`[worker] aws region: ${env.AWS_REGION}`);

let shuttingDown = false;

async function shutdown(signal: string) {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`[worker] ${signal} received, shutting down...`);
	await Promise.allSettled([
		planWorker.close(),
		applyWorker.close(),
		maintenanceWorker.close(),
	]);
	process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await new Promise<never>(() => {});
