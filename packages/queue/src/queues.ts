import { env } from "@my-better-t-app/env/queue";
import { Queue } from "bullmq";
import Redis from "ioredis";
import {
	INFRA_APPLY_QUEUE,
	INFRA_PLAN_QUEUE,
	type InfraApplyJobData,
	type InfraPlanJobData,
	MAINTENANCE_QUEUE,
	type MaintenanceJobData,
	REPO_QUEUE,
	type RepoJobData,
} from "./types";

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

let planQueue: Queue<InfraPlanJobData> | null = null;

export function getPlanQueue(): Queue<InfraPlanJobData> {
	planQueue ??= new Queue<InfraPlanJobData>(INFRA_PLAN_QUEUE, {
		connection,
		defaultJobOptions: {
			removeOnComplete: 200,
			removeOnFail: 200,
			attempts: 1,
		},
	});
	return planQueue;
}

let applyQueue: Queue<InfraApplyJobData> | null = null;

export function getApplyQueue(): Queue<InfraApplyJobData> {
	applyQueue ??= new Queue<InfraApplyJobData>(INFRA_APPLY_QUEUE, {
		connection,
		defaultJobOptions: {
			removeOnComplete: 200,
			removeOnFail: 200,
			attempts: 1,
		},
	});
	return applyQueue;
}

let maintenanceQueue: Queue<MaintenanceJobData> | null = null;

export function getMaintenanceQueue(): Queue<MaintenanceJobData> {
	maintenanceQueue ??= new Queue<MaintenanceJobData>(MAINTENANCE_QUEUE, {
		connection,
		defaultJobOptions: {
			removeOnComplete: 100,
			removeOnFail: 100,
			attempts: 3,
			backoff: { type: "exponential", delay: 2000 },
		},
	});
	return maintenanceQueue;
}

let repoQueue: Queue<RepoJobData> | null = null;

export function getRepoQueue(): Queue<RepoJobData> {
	repoQueue ??= new Queue<RepoJobData>(REPO_QUEUE, {
		connection,
		defaultJobOptions: {
			removeOnComplete: 200,
			removeOnFail: 200,
			attempts: 1,
		},
	});
	return repoQueue;
}
