import { Deployment, Project } from "@my-better-t-app/db";
import { getRepoQueue } from "@my-better-t-app/queue";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { recordApiDeploymentEvent } from "../lib/deployment-events";
import { type AppEnv, requireAuth } from "../lib/session";

const createRepoSchema = z.object({
	projectId: z.string().regex(/^[a-f\d]{24}$/i, "invalid project id"),
	/** Optional override of the project's configured repo/branch/server. */
	repoUrl: z.string().url().optional(),
	repoBranch: z.string().min(1).max(200).optional(),
	serverId: z
		.string()
		.regex(/^[a-f\d]{24}$/i, "invalid server id")
		.optional(),
	commitSha: z.string().min(1).max(64).optional(),
	config: z
		.array(
			z.object({
				key: z.string(),
				value: z.string(),
			}),
		)
		.optional(),
});

export function createRepoDeploymentsRoute(
	auth: MiddlewareHandler<AppEnv> = requireAuth,
): Hono<AppEnv> {
	const repoRoute = new Hono<AppEnv>();

	repoRoute.use("*", auth);

	async function loadOwnedRepoSchema(c: Context<AppEnv>, id: string) {
		const userId = c.get("userId");
		if (!/^[a-f\d]{24}$/i.test(id)) return null;
		const deployment = await Deployment.findById(id).lean();
		if (!deployment) return null;
		const project = await Project.findById(deployment.projectId).lean();
		if (!project || String(project.ownerUserId) !== userId) return null;
		return deployment;
	}

	repoRoute.get("/", async (c) => {
		const userId = c.get("userId");
		const ownedProjectIds = await Project.find({ ownerUserId: userId }).select(
			"_id",
		);
		const projectIds = ownedProjectIds.map((p: { _id: unknown }) => p._id);
		const deployments = await Deployment.find({
			kind: "repo",
			projectId: { $in: projectIds },
		})
			.select("-events")
			.sort({ createdAt: -1 })
			.limit(100)
			.lean();
		return c.json({ deployments });
	});

	repoRoute.post("/", async (c) => {
		const parsed = createRepoSchema.safeParse(await c.req.json());
		if (!parsed.success) {
			return c.json(
				{ error: "Invalid request", issues: parsed.error.issues },
				400,
			);
		}
		const project = await Project.findById(parsed.data.projectId).lean();
		if (!project || String(project.ownerUserId) !== c.get("userId")) {
			return c.json({ error: "Not found" }, 404);
		}
		if (project.kind !== "repo" || !project.repo) {
			return c.json(
				{ error: "Project is not configured for repo deployments" },
				409,
			);
		}

		const repoUrl = parsed.data.repoUrl ?? project.repo.url;
		const repoBranch = parsed.data.repoBranch ?? project.repo.branch;
		const serverId = parsed.data.serverId ?? project.repo.serverId?.toString();

		if (!serverId) {
			return c.json(
				{ error: "No target server configured for this project" },
				409,
			);
		}

		const now = new Date();
		const deployment = await Deployment.create({
			projectId: project._id,
			kind: "repo",
			status: "queued",
			action: "provision",
			serverId,
			repoUrl,
			repoBranch,
			commitSha: parsed.data.commitSha,
			createdAt: now,
			updatedAt: now,
		});

		await recordApiDeploymentEvent(String(deployment._id), {
			level: "info",
			message: `Queued repo deploy for ${repoBranch}@${safeHost(repoUrl)}`,
			status: "queued",
		});

		await getRepoQueue().add(
			"repo-deploy",
			{ deploymentId: String(deployment._id) },
			{ jobId: String(deployment._id) },
		);

		const withEvents = await Deployment.findById(deployment._id).lean();
		return c.json({ deployment: withEvents ?? deployment }, 201);
	});

	const RETRYABLE_STATUSES = ["failed", "canceled"] as const;

	repoRoute.post("/:id/retry", async (c) => {
		const deployment = await loadOwnedRepoSchema(c, c.req.param("id"));
		if (!deployment) return c.json({ error: "Not found" }, 404);
		if (deployment.kind !== "repo") {
			return c.json(
				{ error: "Deployment is not a repo deployment" },
				409,
			);
		}
		const status = deployment.status as string;
		if (
			!RETRYABLE_STATUSES.includes(
				status as (typeof RETRYABLE_STATUSES)[number],
			)
		) {
			return c.json(
				{ error: `Cannot retry deployment in status "${status}"` },
				409,
			);
		}
		const now = new Date();
		const result = await Deployment.updateOne(
			{
				_id: deployment._id,
				status: { $in: [...RETRYABLE_STATUSES] },
			},
			{ $set: { status: "queued", error: undefined, updatedAt: now } },
		);
		if (result.modifiedCount === 0) {
			return c.json({ error: "Deployment is no longer retryable." }, 409);
		}
		await recordApiDeploymentEvent(String(deployment._id), {
			level: "info",
			message: "Deployment retry requested",
			status: "queued",
		});
		try {
			const queue = getRepoQueue();
			const old = await queue.getJob(String(deployment._id));
			if (old) await old.remove();
			await queue.add(
				"repo-deploy",
				{ deploymentId: String(deployment._id) },
				{ jobId: String(deployment._id) },
			);
		} catch (error) {
			console.error("[api] repo retry: failed to requeue repo job:", error);
			return c.json({ error: "Failed to requeue deployment job" }, 500);
		}
		return c.json({ ok: true, status: "queued" });
	});

	const CANCELLABLE_STATUSES = ["queued", "initializing", "planning"] as const;

	repoRoute.post("/:id/cancel", async (c) => {
		const deployment = await loadOwnedRepoSchema(c, c.req.param("id"));
		if (!deployment) return c.json({ error: "Not found" }, 404);
		if (deployment.kind !== "repo") {
			return c.json(
				{ error: "Deployment is not a repo deployment" },
				409,
			);
		}
		const status = deployment.status as string;
		if (
			!CANCELLABLE_STATUSES.includes(
				status as (typeof CANCELLABLE_STATUSES)[number],
			)
		) {
			return c.json(
				{
					error:
						status === "completed" || status === "failed"
							? "Deployment is already finished."
							: "Too late to cancel — deployment is already in progress.",
				},
				409,
			);
		}
		const now = new Date();
		const result = await Deployment.updateOne(
			{
				_id: deployment._id,
				status: { $in: [...CANCELLABLE_STATUSES] },
			},
			{
				$set: {
					status: "canceled",
					completedAt: now,
					updatedAt: now,
				},
			},
		);
		if (result.modifiedCount === 0) {
			return c.json(
				{ error: "Deployment is no longer cancellable." },
				409,
			);
		}
		try {
			const job = await getRepoQueue()
				.getJob(String(deployment._id))
				.catch(() => null);
			if (job) await job.remove();
		} catch {
			// nothing to remove — job already picked up
		}
		await recordApiDeploymentEvent(String(deployment._id), {
			level: "error",
			message: "Deployment canceled by user",
			status: "canceled",
		});
		return c.json({ ok: true, status: "canceled" });
	});

	return repoRoute;
}

function safeHost(repoUrl: string): string {
	try {
		return new URL(repoUrl).hostname;
	} catch {
		return repoUrl;
	}
}
