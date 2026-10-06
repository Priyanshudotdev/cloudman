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

const updateServerSchema = z.object({
	label: z.string().min(1).max(80).optional(),
	host: z
		.string()
		.min(1)
		.max(253)
		.regex(HOST_PATTERN, "must be a valid hostname, IPv4 or IPv6 address")
		.optional(),
	port: z.number().int().min(1).max(65535).optional(),
	sshUser: z.string().min(1).max(100).optional(),
	authMode: z.enum(["key", "password"]).optional(),
	credential: z.string().min(1).optional(),
	remoteAppDir: z.string().min(1).optional(),
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
		if (!env.CLOUDMAN_SECRET) {
			return c.json(
				{
					error:
						"Secret storage is not configured on this server (CLOUDMAN_SECRET missing). Server cannot be saved.",
				},
				503,
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
			credentialEnc: encryptSecret(credential, env.CLOUDMAN_SECRET),
			userId: c.get("userId"),
		});
		const safe = server.toObject();
		delete (safe as { credentialEnc?: string }).credentialEnc;
		return c.json({ server: safe }, 201);
	});

	serversRoute.put("/:id", async (c) => {
		const id = c.req.param("id");
		if (!/^[a-f\d]{24}$/i.test(id)) return c.json({ error: "Not found" }, 404);
		const parsed = updateServerSchema.safeParse(await c.req.json());
		if (!parsed.success) {
			return c.json(
				{ error: "Invalid request", issues: parsed.error.issues },
				400,
			);
		}
		if (
			parsed.data.label === undefined &&
			parsed.data.host === undefined &&
			parsed.data.port === undefined &&
			parsed.data.sshUser === undefined &&
			parsed.data.authMode === undefined &&
			parsed.data.credential === undefined &&
			parsed.data.remoteAppDir === undefined
		) {
			return c.json({ error: "Nothing to update" }, 400);
		}
		const patch: Record<string, unknown> = { updatedAt: new Date() };
		if (parsed.data.label !== undefined) patch.label = parsed.data.label;
		if (parsed.data.host !== undefined) patch.host = parsed.data.host;
		if (parsed.data.port !== undefined) patch.port = parsed.data.port;
		if (parsed.data.sshUser !== undefined) patch.sshUser = parsed.data.sshUser;
		if (parsed.data.authMode !== undefined)
			patch.authMode = parsed.data.authMode;
		if (parsed.data.remoteAppDir !== undefined)
			patch.remoteAppDir = parsed.data.remoteAppDir;
		if (parsed.data.credential !== undefined) {
			if (!env.CLOUDMAN_SECRET) {
				return c.json(
					{
						error:
							"Secret storage is not configured on this server (CLOUDMAN_SECRET missing). Server cannot be updated.",
					},
					503,
				);
			}
			patch.credentialEnc = encryptSecret(
				parsed.data.credential,
				env.CLOUDMAN_SECRET,
			);
		}
		const updated = await Server.findOneAndUpdate(
			{ _id: id, userId: c.get("userId") },
			{ $set: patch },
			{ returnDocument: "after", runValidators: true },
		).lean();
		if (!updated) return c.json({ error: "Not found" }, 404);
		const safe = updated as Record<string, unknown>;
		delete safe.credentialEnc;
		return c.json({ server: safe });
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
	 * Host keys are pinned TOFU-style: the SHA256 fingerprint is captured via
	 * `hostVerifier`; a mismatch against the stored `knownHostKey` fails closed
	 * with 502 and updates nothing, otherwise the fingerprint is stored.
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
		const { createHash } = await import("node:crypto");
		let observedFingerprint: string | null = null;
		let observedAlgorithm: string | null = null;
		let hostKeyMismatch = false;
		function parseAlgo(key: Buffer): string | null {
			try {
				if (key.length < 4) return null;
				const len = key.readUInt32BE(0);
				if (key.length < 4 + len) return null;
				const algo = key.subarray(4, 4 + len).toString("utf8");
				return algo || null;
			} catch {
				return null;
			}
		}
		const config: ConnectConfig = {
			host: server.host,
			port: server.port,
			username: server.sshUser,
			timeout: 15_000,
			readyTimeout: 15_000,
			hostVerifier: (key: Buffer) => {
				const digest = createHash("sha256")
					.update(key)
					.digest("base64")
					.replace(/=+$/, "");
				const fingerprint = "SHA256:" + digest;
				observedFingerprint = fingerprint;
				observedAlgorithm = parseAlgo(key);
				if (server.knownHostKey) {
					if (fingerprint !== server.knownHostKey) {
						hostKeyMismatch = true;
						return false;
					}
					return true;
				}
				return true;
			},
		};
		if (server.authMode === "key") config.privateKey = credential;
		else config.password = credential;

		try {
			const { user, hostname } = await sshProbe(config);
			if (hostKeyMismatch) {
				return c.json(
					{ ok: false, error: "Host key mismatch (possible MITM)" },
					502,
				);
			}
			if (!observedFingerprint) {
				return c.json({ ok: false, error: "Failed to verify host key" }, 502);
			}
			const firstSeen = !server.knownHostKey;
			if (firstSeen) {
				await Server.updateOne(
					{ _id: server._id },
					{
						knownHostKey: observedFingerprint,
						hostKeyAlgorithm: observedAlgorithm,
						verifiedAt: new Date(),
						updatedAt: new Date(),
					},
				);
			} else {
				await Server.updateOne(
					{ _id: server._id },
					{ verifiedAt: new Date(), updatedAt: new Date() },
				);
			}
			return c.json({
				ok: true,
				user,
				hostname,
				hostKeyFingerprint: observedFingerprint,
				hostKeyTrusted: !firstSeen,
			});
		} catch (error) {
			if (hostKeyMismatch) {
				return c.json(
					{ ok: false, error: "Host key mismatch (possible MITM)" },
					502,
				);
			}
			// Raw ssh2 errors distinguish ECONNREFUSED / ETIMEDOUT / ENOTFOUND,
			// which turns this endpoint into a port scanner for the API host's
			// egress network. Log the detail, return a stable message.
			console.error("[api] server verify failed", {
				serverId: c.req.param("id"),
				error: error instanceof Error ? error.message : String(error),
			});
			return c.json(
				{
					ok: false,
					error:
						"Could not connect to server — check host, port, and credentials",
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
