import { serve } from "@hono/node-server";
import { getClient } from "@my-better-t-app/db";
import { env } from "@my-better-t-app/env/server";
import { createApp } from "./app";

if (!env.CLOUDMAN_SECRET) {
	console.warn(
		"╔══════════════════════════════════════════════════════════════╗\n" +
			"║  WARNING: CLOUDMAN_SECRET is not set.                       ║\n" +
			"║  AWS external IDs and SSH credentials will be stored in    ║\n" +
			"║  PLAINTEXT. Set CLOUDMAN_SECRET to enable AES-256-GCM     ║\n" +
			"║  encryption at rest.                                      ║\n" +
			"╚══════════════════════════════════════════════════════════════╝",
	);
}

await getClient();

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
