import { Deployment } from "@my-better-t-app/db";

import { env } from "@my-better-t-app/env/worker";
import { deploymentChannel } from "@my-better-t-app/queue";
import Redis from "ioredis";

const publisher = new Redis(env.REDIS_URL, {
	lazyConnect: false,
	maxRetriesPerRequest: null,
});

publisher.on("error", (error: Error) => {
	console.error("[worker] redis publisher error:", error.message);
});

export interface EventInput {
	level: "info" | "success" | "error" | "progress";
	message: string;
	data?: unknown;
}

/**
 * Persists an event onto the deployment document (capped ring of 500)
 * and fans it out over Redis pub/sub for live SSE consumers.
 */
export async function recordDeploymentEvent(
	deploymentId: string,
	event: EventInput,
	status?: string,
): Promise<void> {
	const at = new Date();

	await Deployment.updateOne(
		{ _id: deploymentId },
		{
			...(status ? { $set: { status, updatedAt: at } } : {}),
			$push: {
				events: {
					$each: [
						{
							at,
							level: event.level,
							message: event.message,
							data: event.data,
						},
					],
					$slice: -500,
				},
			},
		},
	);

	await publisher.publish(
		deploymentChannel(deploymentId),
		JSON.stringify({
			deploymentId,
			level: event.level,
			message: event.message,
			status,
			data: event.data,
			at: at.toISOString(),
		}),
	);
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function tail(text: string, maxLines = 25): string {
	const lines = text.trimEnd().split(/\r?\n/);
	return lines.slice(-maxLines).join("\n");
}
