import { env } from "@my-better-t-app/env/queue";
import Redis from "ioredis";

const publisher = new Redis(env.REDIS_URL, {
	lazyConnect: false,
	maxRetriesPerRequest: null,
});

publisher.on("error", (error) => {
	console.error("[queue] redis publisher error:", error.message);
});

export function deploymentChannel(deploymentId: string): string {
	return `deployment:${deploymentId}:events`;
}

export interface DeploymentEventInput {
	deploymentId: string;
	level: "info" | "success" | "error" | "progress";
	message: string;
	status?: string;
	data?: unknown;
}

/** Publish-only variant for processes without a DB handle (API). */
export async function publishDeploymentEvent(payload: {
	deploymentId: string;
	level: DeploymentEventInput["level"];
	message: string;
	status?: string;
	data?: unknown;
	at: string;
}): Promise<void> {
	await publisher.publish(
		deploymentChannel(payload.deploymentId),
		JSON.stringify(payload),
	);
}

export interface DeploymentEventPayload {
	deploymentId: string;
	level: "info" | "success" | "error" | "progress";
	message: string;
	status?: string;
	data?: unknown;
	at: string;
}

/**
 * Creates a dedicated subscriber connection and invokes onEvent for every
 * deployment event received. Returns a cleanup function.
 */
export async function subscribeDeploymentEvents(
	deploymentId: string,
	onEvent: (event: DeploymentEventPayload) => void,
): Promise<() => void> {
	const subscriber = new Redis(env.REDIS_URL, { lazyConnect: false });
	const channel = deploymentChannel(deploymentId);

	subscriber.on("error", (error: Error) => {
		console.error("[queue] redis subscriber error:", error.message);
	});

	subscriber.on("message", (chan: string, raw: string) => {
		if (chan !== channel) return;
		try {
			onEvent(JSON.parse(raw) as DeploymentEventPayload);
		} catch (error) {
			console.error("[queue] failed to parse deployment event:", error);
		}
	});

	await subscriber.subscribe(channel);

	let cleanedUp = false;
	return () => {
		if (cleanedUp) return;
		cleanedUp = true;
		void subscriber.quit();
	};
}

export const deploymentEventChannel = deploymentChannel;

export { Redis };
