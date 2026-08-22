import { serve } from "@hono/node-server";
import { auth } from "@my-better-t-app/auth";
import { env } from "@my-better-t-app/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { awsConnectionsRoute } from "./routes/aws-connections";
import { compileRoute } from "./routes/compile";
import { deploymentsRoute } from "./routes/deployments";
import { projectsRoute } from "./routes/projects";

const app = new Hono();

app.use(logger());

app.use(
	"*",
	cors({
		origin: env.CORS_ORIGIN,
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

app.route("/api/projects", projectsRoute);
app.route("/api/deployments", deploymentsRoute);
app.route("/api/compile", compileRoute);
app.route("/api/aws-connections", awsConnectionsRoute);

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
	console.log(`[api] cloudman api listening on http://localhost:${info.port}`);
});

server.on("error", (error) => {
	console.error("[api] server error:", error.message);
	process.exit(1);
});

let shuttingDown = false;

async function shutdown(signal: string) {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`[api] ${signal} received, shutting down...`);
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
