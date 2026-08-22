import { Deployment, Project } from "@my-better-t-app/db";
import {
	getApplyQueue,
	publishDeploymentEvent,
	subscribeDeploymentEvents,
} from "@my-better-t-app/queue";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../lib/session";
import { requireAuth } from "../lib/session";

export const deploymentsRoute = new Hono<AppEnv>();

deploymentsRoute.use("*", requireAuth);

async function loadOwnedDeployment(c: Context<AppEnv>, id: string) {
	const userId = c.get("userId");
	if (!/^[a-f\d]{24}$/i.test(id)) return null;
	const deployment = await Deployment.findById(id).lean();
	if (!deployment) return null;
	const project = await Project.findById(deployment.projectId).lean();
	if (!project || project.ownerUserId.toString() !== userId) return null;
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
