import { env } from "@my-better-t-app/env/worker";
import {
	INFRA_APPLY_QUEUE,
	INFRA_PLAN_QUEUE,
	type InfraApplyJobData,
	type InfraPlanJobData,
} from "@my-better-t-app/queue";
import { Worker } from "bullmq";
import Redis from "ioredis";

import { handleApplyJob } from "./jobs/apply";
import { handlePlanJob } from "./jobs/plan";

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

for (const [name, worker] of [
	["plan", planWorker],
	["apply", applyWorker],
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
	await Promise.allSettled([planWorker.close(), applyWorker.close()]);
	process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await new Promise<never>(() => {});
