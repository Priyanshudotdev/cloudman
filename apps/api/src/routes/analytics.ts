import { Deployment, Project } from "@my-better-t-app/db";
import { Hono, type MiddlewareHandler } from "hono";
import { type AppEnv, requireAuth } from "../lib/session";

export function createAnalyticsRoute(
	auth: MiddlewareHandler<AppEnv> = requireAuth,
): Hono<AppEnv> {
	const analyticsRoute = new Hono<AppEnv>();

	analyticsRoute.use("*", auth);

	/** Aggregate usage stats for the signed-in user's dashboard. */
	analyticsRoute.get("/", async (c) => {
		const userId = c.get("userId");

		const projects = await Project.find({ ownerUserId: userId }).select("_id");
		const projectIds = projects.map((project) => project._id);
		const deployments = projectIds.length
			? await Deployment.find({ projectId: { $in: projectIds } })
			: [];

		let completed = 0;
		let failed = 0;
		let resourcesManaged = 0;
		const latestProvisionByProject = new Map<
			string,
			{ createdAt: Date; cost: number }
		>();
		for (const deployment of deployments) {
			if (deployment.status !== "completed") {
				if (deployment.status === "failed") failed += 1;
				continue;
			}
			completed += 1;
			const net =
				deployment.action === "destroy"
					? -deployment.planSummary.destroy
					: deployment.planSummary.create +
						deployment.planSummary.update -
						deployment.planSummary.destroy;
			resourcesManaged += Math.max(0, net);

			if (deployment.action !== "provision") continue;
			const projectId = String(deployment.projectId);
			const createdAt = deployment.createdAt ?? new Date(0);
			const current = latestProvisionByProject.get(projectId);
			if (!current || createdAt > current.createdAt) {
				latestProvisionByProject.set(projectId, {
					createdAt,
					cost: deployment.estimatedMonthlyCost ?? 0,
				});
			}
		}
		const settled = completed + failed;
		let monthlySpendEstimate = 0;
		for (const { cost } of latestProvisionByProject.values()) {
			monthlySpendEstimate += cost;
		}
		monthlySpendEstimate = Math.round(monthlySpendEstimate * 100) / 100;

		return c.json({
			stats: {
				projects: projects.length,
				deployments: deployments.length,
				completed,
				failed,
				successRate:
					settled === 0 ? null : Math.round((completed / settled) * 100),
				resourcesManaged,
				monthlySpendEstimate,
			},
		});
	});

	return analyticsRoute;
}
