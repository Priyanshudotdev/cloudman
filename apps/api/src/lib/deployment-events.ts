import { Deployment } from "@my-better-t-app/db";
import { publishDeploymentEvent } from "@my-better-t-app/queue";

type EventLevel = "info" | "success" | "error" | "progress";

interface ApiEventInput {
	level: EventLevel;
	message: string;
	status?: string;
	data?: unknown;
}

/**
 * Persists an API-originated deployment event onto the deployment document
 * (capped ring of 500, mirroring apps/worker/src/lib/events.ts) and fans it
 * out over Redis pub/sub for live SSE consumers.
 */
export async function recordApiDeploymentEvent(
	deploymentId: string,
	event: ApiEventInput,
): Promise<void> {
	const at = new Date();

	await Deployment.updateOne(
		{ _id: deploymentId },
		{
			...(event.status
				? { $set: { status: event.status, updatedAt: at } }
				: {}),
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

	await publishDeploymentEvent({
		deploymentId,
		level: event.level,
		message: event.message,
		status: event.status,
		data: event.data,
		at: at.toISOString(),
	});
}
