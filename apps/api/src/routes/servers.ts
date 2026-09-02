import {
	encryptSecret,
	resolveServerCredential,
	Server,
} from "@my-better-t-app/db";
import { env } from "@my-better-t-app/env/server";
import { Hono, type MiddlewareHandler } from "hono";
import { Client, type ConnectConfig } from "ssh2";
import { z } from "zod";
import { type AppEnv, requireAuth } from "../lib/session";

const HOST_PATTERN =
	/^(([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}|(\d{1,3}\.){3}\d{1,3}|(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}))$/;

const serverSchema = z.object({
	label: z.string().min(1).max(80),
	host: z
		.string()
		.min(1)
		.max(253)
		.regex(HOST_PATTERN, "must be a valid hostname, IPv4 or IPv6 address"),
	port: z.number().int().min(1).max(65535).default(22),
	sshUser: z.string().min(1).max(100).default("root"),
	authMode: z.enum(["key", "password"]).default("key"),
	/** PEM private key (authMode=key) or password (authMode=password). */
	credential: z.string().min(1),
	remoteAppDir: z.string().min(1).default("/srv/cloudman"),
});

export function createServersRoute(
	auth: MiddlewareHandler<AppEnv> = requireAuth,
): Hono<AppEnv> {
	const serversRoute = new Hono<AppEnv>();

	serversRoute.use("*", auth);

	serversRoute.get("/", async (c) => {
		const servers = await Server.find({ userId: c.get("userId") })
			.select("-credentialEnc")
			.sort({ createdAt: -1 })
			.lean();
		return c.json({ servers });
	});

	serversRoute.post("/", async (c) => {
		const parsed = serverSchema.safeParse(await c.req.json());
		if (!parsed.success) {
			return c.json(
				{ error: "Invalid request", issues: parsed.error.issues },
				400,
			);
		}
		// Strip host from credential so it is never stored or returned in plaintext.
		const credential = parsed.data.credential;
		const server = await Server.create({
			label: parsed.data.label,
			host: parsed.data.host,
			port: parsed.data.port,
			sshUser: parsed.data.sshUser,
			authMode: parsed.data.authMode,
			remoteAppDir: parsed.data.remoteAppDir,
			credentialEnc: env.CLOUDMAN_SECRET
				? encryptSecret(credential, env.CLOUDMAN_SECRET)
				: credential,
			userId: c.get("userId"),
		});
		const safe = server.toObject();
		delete (safe as { credentialEnc?: string }).credentialEnc;
		return c.json({ server: safe }, 201);
	});

	serversRoute.delete("/:id", async (c) => {
		const id = c.req.param("id");
		if (!/^[a-f\d]{24}$/i.test(id)) return c.json({ error: "Not found" }, 404);
		const result = await Server.deleteOne({
			_id: id,
			userId: c.get("userId"),
		});
		if (result.deletedCount === 0) return c.json({ error: "Not found" }, 404);
		return c.json({ ok: true });
	});

	/**
	 * Proves a stored server is reachable: opens an SSH shell, runs `whoami` +
	 * `hostname`, then closes. Nothing is written or executed beyond that.
	 */
	serversRoute.post("/:id/verify", async (c) => {
		const id = c.req.param("id");
		if (!/^[a-f\d]{24}$/i.test(id)) return c.json({ error: "Not found" }, 404);
		const server = await Server.findOne({
			_id: id,
			userId: c.get("userId"),
		}).lean();
		if (!server) return c.json({ error: "Not found" }, 404);

		const credential = resolveServerCredential(
			server.credentialEnc,
			env.CLOUDMAN_SECRET,
		);
		const config: ConnectConfig = {
			host: server.host,
			port: server.port,
			username: server.sshUser,
			timeout: 15_000,
			readyTimeout: 15_000,
		};
		if (server.authMode === "key") config.privateKey = credential;
		else config.password = credential;

		try {
			const { user, hostname } = await sshProbe(config);
			await Server.updateOne(
				{ _id: server._id },
				{ verifiedAt: new Date(), updatedAt: new Date() },
			);
			return c.json({ ok: true, user, hostname });
		} catch (error) {
			return c.json(
				{
					ok: false,
					error:
						error instanceof Error
							? error.message
							: "Failed to connect to server",
				},
				502,
			);
		}
	});

	return serversRoute;
}

function sshProbe(
	config: ConnectConfig,
): Promise<{ user: string; hostname: string }> {
	return new Promise((resolve, reject) => {
		const client = new Client();
		client.on("ready", () => {
			client.exec("whoami; hostname", (err, stream) => {
				if (err) {
					client.end();
					return reject(err);
				}
				let output = "";
				stream
					.on("data", (d: Buffer) => (output += d.toString("utf8")))
					.on("close", () => {
						client.end();
						const lines = output.trim().split(/\r?\n/);
						resolve({
							user: lines[0]?.trim() ?? config.username ?? "",
							hostname: lines[1]?.trim() ?? "",
						});
					});
				stream.stderr.on("data", (d: Buffer) => (output += d.toString("utf8")));
			});
		});
		client.on("error", (err) => {
			client.end();
			reject(err);
		});
		client.connect(config);
	});
}
