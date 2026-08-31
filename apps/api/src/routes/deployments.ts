import { Deployment, Project } from "@my-better-t-app/db";
import {
	getApplyQueue,
	getPlanQueue,
	publishDeploymentEvent,
	subscribeDeploymentEvents,
} from "@my-better-t-app/queue";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { streamSSE } from "hono/streaming";
import { type AppEnv, requireAuth } from "../lib/session";

export function createDeploymentsRoute(
	auth: MiddlewareHandler<AppEnv> = requireAuth,
): Hono<AppEnv> {
	const deploymentsRoute = new Hono<AppEnv>();

	deploymentsRoute.use("*", auth);

	async function loadOwnedDeployment(c: Context<AppEnv>, id: string) {
		const userId = c.get("userId");
		if (!/^[a-f\d]{24}$/i.test(id)) return null;
		const deployment = await Deployment.findById(id).lean();
		if (!deployment) return null;
		const project = await Project.findById(deployment.projectId).lean();
		if (!project || String(project.ownerUserId) !== userId) return null;
		return deployment;
	}

	deploymentsRoute.get("/:id", async (c) => {
		const deployment = await loadOwnedDeployment(c, c.req.param("id"));
		if (!deployment) return c.json({ error: "Not found" }, 404);
		return c.json({ deployment });
	});

	deploymentsRoute.get("/:id/events", async (c) => {
		const id = c.req.param("id");
		const deployment = await loadOwnedDeployment(c, id);
		if (!deployment) return c.json({ error: "Not found" }, 404);

		const backlog = [...deployment.events];

		return streamSSE(c, async (stream) => {
			let closed = false;

			for (const event of backlog) {
				await stream.writeSSE({
					event: "deployment",
					data: JSON.stringify(event),
				});
			}

			const cleanup = closed
				? null
				: await subscribeDeploymentEvents(id, (event) => {
						void stream.writeSSE({
							event: "deployment",
							data: JSON.stringify(event),
						});
					});

			const abort = () => {
				closed = true;
				cleanup?.();
			};
			c.req.raw.signal.addEventListener("abort", abort);

			try {
				while (!closed && !c.req.raw.signal.aborted) {
					await stream.sleep(15_000);
					await stream.writeSSE({ event: "ping", data: Date.now().toString() });
				}
			} finally {
				cleanup?.();
				c.req.raw.signal.removeEventListener("abort", abort);
			}
		});
	});

	deploymentsRoute.post("/:id/approve", async (c) => {
		const deployment = await loadOwnedDeployment(c, c.req.param("id"));
		if (!deployment) return c.json({ error: "Not found" }, 404);
		if (deployment.status !== "awaiting_approval") {
			return c.json(
				{ error: `Cannot approve deployment in status "${deployment.status}"` },
				409,
			);
		}

		const now = new Date();
		await Deployment.updateOne(
			{ _id: deployment._id },
			{ status: "apply_queued", updatedAt: now },
		);
		await publishDeploymentEvent({
			deploymentId: String(deployment._id),
			level: "success",
			message: "Plan approved by user — queued for apply",
			status: "apply_queued",
			at: now.toISOString(),
		});

		await getApplyQueue().add(
			"apply",
			{ deploymentId: String(deployment._id) },
			{ jobId: String(deployment._id) },
		);

		return c.json({ ok: true, status: "apply_queued" });
	});

	const CANCELLABLE_STATUSES = [
		"queued",
		"initializing",
		"planning",
		"planned",
		"awaiting_approval",
	] as const;

	deploymentsRoute.post("/:id/cancel", async (c) => {
		const deployment = await loadOwnedDeployment(c, c.req.param("id"));
		if (!deployment) return c.json({ error: "Not found" }, 404);

		const status = deployment.status as string;
		if (
			!CANCELLABLE_STATUSES.includes(
				status as (typeof CANCELLABLE_STATUSES)[number],
			)
		) {
			return c.json(
				{
					error:
						status === "apply_queued" || status === "applying"
							? "Too late to cancel — infrastructure changes are already being applied."
							: `Deployment is already ${status}.`,
				},
				409,
			);
		}

		const now = new Date();
		await Deployment.updateOne(
			{ _id: deployment._id },
			{ $set: { status: "canceled", completedAt: now, updatedAt: now } },
		);
		try {
			const removed = await getPlanQueue().remove(String(deployment._id));
			if (!removed) {
				console.warn(
					`[api] cancel: job for ${String(deployment._id)} not found in queue (already picked up?)`,
				);
			}
		} catch (error) {
			console.error("[api] cancel: failed to remove queued plan job:", error);
		}
		await publishDeploymentEvent({
			deploymentId: String(deployment._id),
			level: "error",
			message: "Deployment canceled by user",
			status: "canceled",
			at: now.toISOString(),
		});

		return c.json({ ok: true, status: "canceled" });
	});

	const RETRYABLE_STATUSES = ["failed", "canceled"] as const;

	deploymentsRoute.post("/:id/retry", async (c) => {
		const deployment = await loadOwnedDeployment(c, c.req.param("id"));
		if (!deployment) return c.json({ error: "Not found" }, 404);

		const status = deployment.status as string;
		if (
			!RETRYABLE_STATUSES.includes(
				status as (typeof RETRYABLE_STATUSES)[number],
			)
		) {
			return c.json(
				{
					error: `Cannot retry deployment in status "${status}" — only failed or canceled deployments can be retried.`,
				},
				409,
			);
		}

		const now = new Date();
		await Deployment.updateOne(
			{ _id: deployment._id },
			{ $set: { status: "queued", updatedAt: now } },
		);
		await publishDeploymentEvent({
			deploymentId: String(deployment._id),
			level: "info",
			message: "Deployment retry requested",
			status: "queued",
			at: now.toISOString(),
		});

		await getPlanQueue().add(
			"plan",
			{ deploymentId: String(deployment._id) },
			{ jobId: String(deployment._id) },
		);

		return c.json({ ok: true, status: "queued" });
	});

	return deploymentsRoute;
}
