import { auth } from "@my-better-t-app/auth";
import { env } from "@my-better-t-app/env/server";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { type AppEnv, requireAuth } from "./lib/session";
import { createAwsConnectionsRoute } from "./routes/aws-connections";
import { createCompileRoute } from "./routes/compile";
import { createDeploymentsRoute } from "./routes/deployments";
import { createGenerateRoute } from "./routes/generate";
import { createProjectsRoute } from "./routes/projects";

export interface CreateAppOptions {
	authMiddleware?: MiddlewareHandler<AppEnv>;
	corsOrigin?: string;
	disableLogging?: boolean;
}

export function createApp(options: CreateAppOptions = {}): Hono<AppEnv> {
	const authMiddleware = options.authMiddleware ?? requireAuth;
	const app = new Hono<AppEnv>();

	if (!options.disableLogging) {
		app.use(logger());
	}

	app.use(
		"*",
		cors({
			origin: options.corsOrigin ?? env.CORS_ORIGIN,
			allowHeaders: ["Content-Type", "Authorization"],
			allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
			credentials: true,
		}),
	);

	app.onError((error, c) => {
		console.error("[api] unhandled error:", error);
		return c.json({ error: "Internal Server Error" }, 500);
	});

	app.notFound((c) => c.json({ error: "Not Found" }, 404));

	app.get("/health", (c) =>
		c.json({
			ok: true,
			service: "cloudman-api",
			environment: env.NODE_ENV,
			time: new Date().toISOString(),
		}),
	);

	app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

	app.route("/api/projects", createProjectsRoute(authMiddleware));
	app.route("/api/deployments", createDeploymentsRoute(authMiddleware));
	app.route("/api/compile", createCompileRoute(authMiddleware));
	app.route("/api/aws-connections", createAwsConnectionsRoute(authMiddleware));
	app.route("/api/generate", createGenerateRoute(authMiddleware));

	return app;
}
