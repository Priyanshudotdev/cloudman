import { buildBlueprint, listBlueprints } from "@my-better-t-app/core";
import { Hono, type MiddlewareHandler } from "hono";
import { type AppEnv, requireAuth } from "../lib/session";

/**
 * One-click stack templates. Exposes the curated blueprint catalog plus a way
 * to build a fresh graph from any template by id.
 */
export function createBlueprintsRoute(
	auth: MiddlewareHandler<AppEnv> = requireAuth,
): Hono<AppEnv> {
	const blueprintsRoute = new Hono<AppEnv>();

	blueprintsRoute.use("*", auth);

	blueprintsRoute.get("/", (c) => {
		return c.json({ blueprints: listBlueprints() });
	});

	blueprintsRoute.get("/:id", (c) => {
		const { id } = c.req.param();
		let graph: ReturnType<typeof buildBlueprint>;
		try {
			graph = buildBlueprint(id);
		} catch (error) {
			return c.json(
				{
					error: error instanceof Error ? error.message : "Unknown blueprint",
				},
				404,
			);
		}
		return c.json({ blueprint: id, graph });
	});

	return blueprintsRoute;
}
