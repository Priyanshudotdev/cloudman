import { validateGraph } from "@my-better-t-app/core";
import {
	AwsConnection,
	Deployment,
	GraphVersion,
	Project,
} from "@my-better-t-app/db";
import {
	getMaintenanceQueue,
	getPlanQueue,
	publishDeploymentEvent,
} from "@my-better-t-app/queue";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { type AppEnv, requireAuth } from "../lib/session";

export function createProjectsRoute(
	auth: MiddlewareHandler<AppEnv> = requireAuth,
): Hono<AppEnv> {
	const projectsRoute = new Hono<AppEnv>();

	projectsRoute.use("*", auth);

	async function loadOwnedProject(c: Context<AppEnv>, id: string) {
		const userId = c.get("userId");
		if (!/^[a-f\d]{24}$/i.test(id)) return null;
		const project = await Project.findById(id).lean();
		if (!project || String(project.ownerUserId) !== userId) return null;
		return project;
	}

	const createProjectSchema = z.object({
		name: z.string().min(1).max(120),
		description: z.string().max(500).default(""),
	});

	projectsRoute.post("/", async (c) => {
		const body = createProjectSchema.safeParse(await c.req.json());
		if (!body.success) {
			return c.json(
				{ error: "Invalid request", issues: body.error.issues },
				400,
			);
		}
		const project = await Project.create({
			name: body.data.name,
			description: body.data.description,
			ownerUserId: c.get("userId"),
		});
		return c.json({ project }, 201);
	});

	projectsRoute.get("/", async (c) => {
		const projects = await Project.find({ ownerUserId: c.get("userId") })
			.sort({ updatedAt: -1 })
			.limit(100)
			.lean();
		return c.json({ projects });
	});

	projectsRoute.get("/:id", async (c) => {
		const project = await loadOwnedProject(c, c.req.param("id"));
		if (!project) return c.json({ error: "Not found" }, 404);
		return c.json({ project });
	});

	const updateProjectSchema = z.object({
		name: z.string().min(1).max(120).optional(),
		description: z.string().max(500).optional(),
	});

	projectsRoute.put("/:id", async (c) => {
		const id = c.req.param("id");
		const project = await loadOwnedProject(c, id);
		if (!project) return c.json({ error: "Not found" }, 404);

		const parsed = updateProjectSchema.safeParse(await c.req.json());
		if (!parsed.success) {
			return c.json(
				{ error: "Invalid request", issues: parsed.error.issues },
				400,
			);
		}
		if (
			parsed.data.name === undefined &&
			parsed.data.description === undefined
		) {
			return c.json({ error: "Nothing to update" }, 400);
		}

		const patch: Record<string, unknown> = { updatedAt: new Date() };
		if (parsed.data.name !== undefined) patch.name = parsed.data.name;
		if (parsed.data.description !== undefined)
			patch.description = parsed.data.description;

		const updated = await Project.findByIdAndUpdate(id, patch, {
			returnDocument: "after",
			runValidators: true,
		}).lean();
		if (!updated) return c.json({ error: "Not found" }, 404);
		return c.json({ project: updated });
	});

	projectsRoute.delete("/:id", async (c) => {
		const id = c.req.param("id");
		const project = await loadOwnedProject(c, id);
		if (!project) return c.json({ error: "Not found" }, 404);

		const activeStatuses = [
			"queued",
			"initializing",
			"planning",
			"planned",
			"awaiting_approval",
			"apply_queued",
			"applying",
		] as const;
		if (
			await Deployment.exists({
				projectId: id,
				status: { $in: activeStatuses },
			})
		) {
			return c.json(
				{ error: "A deployment is in flight — wait for it to finish." },
				409,
			);
		}

		const lastCompleted = await Deployment.findOne({
			projectId: id,
			status: "completed",
		})
			.sort({ createdAt: -1 })
			.lean();
		if (lastCompleted?.action === "provision") {
			return c.json(
				{
					error:
						"Infrastructure is still deployed — run Destroy before deleting the project.",
				},
				409,
			);
		}

		await Promise.all([
			GraphVersion.deleteMany({ projectId: id }),
			Deployment.deleteMany({ projectId: id }),
			Project.findByIdAndDelete(id),
		]);
		try {
			await getMaintenanceQueue().add("cleanup-workspace", {
				kind: "cleanup-workspace",
				projectId: id,
			});
		} catch (error) {
			console.error("[api] failed to enqueue workspace cleanup:", error);
		}
		return c.json({ ok: true });
	});

	const saveGraphSchema = z.object({
		graph: z.record(z.string(), z.unknown()),
	});

	projectsRoute.put("/:id/graph", async (c) => {
		const id = c.req.param("id");
		const project = await loadOwnedProject(c, id);
		if (!project) return c.json({ error: "Not found" }, 404);

		const raw = await c.req.json();
		const parsed = saveGraphSchema.safeParse(raw);
		if (!parsed.success) {
			return c.json(
				{ error: "Invalid request", issues: parsed.error.issues },
				400,
			);
		}

		const validation = validateGraph(parsed.data.graph);
		if (!validation.valid) {
			return c.json(
				{ error: "Graph validation failed", issues: validation.issues },
				422,
			);
		}

		const version = project.latestGraphVersion + 1;
		const graphVersion = await GraphVersion.create({
			projectId: id,
			version,
			graph: parsed.data.graph,
			createdByUserId: c.get("userId"),
		});
		await Project.updateOne(
			{ _id: id },
			{ latestGraphVersion: version, updatedAt: new Date() },
		);

		return c.json({ graphVersionId: graphVersion._id, version }, 201);
	});

	projectsRoute.get("/:id/graph/latest", async (c) => {
		const id = c.req.param("id");
		const project = await loadOwnedProject(c, id);
		if (!project) return c.json({ error: "Not found" }, 404);
		const latest = await GraphVersion.findOne({ projectId: id })
			.sort({ version: -1 })
			.lean();
		return c.json({ graphVersion: latest ?? null });
	});

	projectsRoute.get("/:id/graphs", async (c) => {
		const id = c.req.param("id");
		const project = await loadOwnedProject(c, id);
		if (!project) return c.json({ error: "Not found" }, 404);
		const versions = await GraphVersion.find({ projectId: id })
			.select("_id version createdAt")
			.sort({ version: -1 })
			.limit(50)
			.lean();
		return c.json({ versions });
	});

	const createDeploymentSchema = z.object({
		awsConnectionId: z
			.string()
			.regex(/^[a-f\d]{24}$/i)
			.optional(),
		region: z.string().min(1).optional(),
		action: z.enum(["provision", "destroy"]).default("provision"),
	});

	/**
	 * Creates a deployment record and enqueues the infra-plan job.
	 * Status lifecycle:
	 *   queued → initializing → planning → planned → awaiting_approval
	 *   → apply_queued → applying → completed | failed
	 *
	 * Destroy deployments intentionally pin the graph version of the last
	 * COMPLETED provision — tearing down must match what was built, not the
	 * latest canvas edits.
	 */
	projectsRoute.post("/:id/deployments", async (c) => {
		const id = c.req.param("id");
		const project = await loadOwnedProject(c, id);
		if (!project) return c.json({ error: "Not found" }, 404);

		const parsed = createDeploymentSchema.safeParse(
			await c.req.json().catch(() => ({})),
		);
		if (!parsed.success) {
			return c.json(
				{ error: "Invalid request", issues: parsed.error.issues },
				400,
			);
		}

		let graphVersion: { _id: unknown } | null;
		if (parsed.data.action === "destroy") {
			const lastCompleted = await Deployment.findOne({
				projectId: id,
				action: "provision",
				status: "completed",
			}).sort({ createdAt: -1 });
			if (!lastCompleted) {
				return c.json(
					{ error: "Nothing to destroy — project has no completed deployment" },
					409,
				);
			}
			graphVersion = await GraphVersion.findById(
				lastCompleted.graphVersionId,
			).lean();
		} else {
			graphVersion = await GraphVersion.findOne({ projectId: id })
				.sort({ version: -1 })
				.lean();
		}
		if (!graphVersion) {
			return c.json(
				{ error: "Project has no saved infrastructure graph" },
				409,
			);
		}

		if (parsed.data.awsConnectionId) {
			const connection = await AwsConnection.findOne({
				_id: parsed.data.awsConnectionId,
				userId: c.get("userId"),
			}).lean();
			if (!connection)
				return c.json({ error: "AWS connection not found" }, 404);
		}

		const now = new Date();
		const deployment = await Deployment.create({
			projectId: id,
			graphVersionId: String(graphVersion._id),
			status: "queued",
			action: parsed.data.action,
			awsConnectionId: parsed.data.awsConnectionId,
			region: parsed.data.region ?? "us-east-1",
			startedAt: now,
		});

		await publishDeploymentEvent({
			deploymentId: String(deployment._id),
			level: parsed.data.action === "destroy" ? "error" : "info",
			message:
				parsed.data.action === "destroy"
					? `Destruction requested for project "${project.name}"`
					: `Deployment queued for project "${project.name}"`,
			status: "queued",
			at: now.toISOString(),
		});

		await getPlanQueue().add(
			"plan",
			{ deploymentId: String(deployment._id) },
			{ jobId: String(deployment._id) },
		);

		return c.json({ deployment }, 201);
	});

	projectsRoute.get("/:id/deployments", async (c) => {
		const id = c.req.param("id");
		const project = await loadOwnedProject(c, id);
		if (!project) return c.json({ error: "Not found" }, 404);
		const deployments = await Deployment.find({ projectId: id })
			.select("-events")
			.sort({ createdAt: -1 })
			.limit(50)
			.lean();
		return c.json({ deployments });
	});

	return projectsRoute;
}
