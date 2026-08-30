import { serve } from "@hono/node-server";
import { env } from "@my-better-t-app/env/server";
import { createApp } from "./app";

const app = createApp();

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
