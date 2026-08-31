import {
	analyzeRisks,
	buildIR,
	compileIR,
	estimateCost,
	exportCloudFormation,
} from "@my-better-t-app/core";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { type AppEnv, requireAuth } from "../lib/session";

export function createCompileRoute(
	auth: MiddlewareHandler<AppEnv> = requireAuth,
): Hono<AppEnv> {
	const compileRoute = new Hono<AppEnv>();

	compileRoute.use("*", auth);

	const compileSchema = z.object({
		graph: z.record(z.string(), z.unknown()),
		region: z.string().min(1).optional(),
		bucketNameSuffix: z.string().min(3).max(20).optional(),
	});

	/**
	 * Stateless preview: graph → IR → generated OpenTofu files.
	 * Nothing is persisted; used by the plan/config UI before saving or deploying.
	 */
	compileRoute.post("/", async (c) => {
		const parsed = compileSchema.safeParse(await c.req.json());
		if (!parsed.success) {
			return c.json(
				{ error: "Invalid request", issues: parsed.error.issues },
				400,
			);
		}

		const built = buildIR(parsed.data.graph, { region: parsed.data.region });
		if (!built.ok) {
			return c.json(
				{ error: "Graph validation failed", issues: built.issues },
				422,
			);
		}

		const suffix =
			parsed.data.bucketNameSuffix ??
			Math.random().toString(16).slice(2, 10).padEnd(8, "0");
		const files = compileIR(built.document, { bucketNameSuffix: suffix });
		const cost = estimateCost(built.document);
		const risks = analyzeRisks(built.document);

		return c.json({
			ir: built.document,
			files,
			cloudFormation: exportCloudFormation(built.document),
			stats: {
				resources: built.document.resources.length,
				files: files.length,
				bytes: files.reduce((sum, f) => sum + f.contents.length, 0),
			},
			cost,
			risks,
		});
	});
	return compileRoute;
}
