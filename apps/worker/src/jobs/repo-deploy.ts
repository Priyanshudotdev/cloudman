import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
	Deployment,
	Project,
	resolveServerCredential,
	Server,
} from "@my-better-t-app/db";
import { env } from "@my-better-t-app/env/worker";
import type { RepoJobData } from "@my-better-t-app/queue";
import {
	artifactPaths,
	buildRecipe,
	type DetectedStack,
	detectStack,
	type RepoFileView,
	renderRuntime,
	shapePlan,
	summarize,
} from "@my-better-t-app/repo";
import type { Job } from "bullmq";
import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2";
import { recordDeploymentEvent, sleep, tail } from "../lib/events";

function workspaceRoot(): string {
	return (
		env.CLOUDMAN_WORKSPACE_ROOT ?? path.join(os.tmpdir(), "cloudman-workspaces")
	);
}

function repoDirFor(deploymentId: string): string {
	return path.join(workspaceRoot(), "repo-" + deploymentId);
}

/** Shell single-quote escaping for remote commands. */
function sq(value: string): string {
	return "'" + value.replace(/'/g, "'\\''") + "'";
}

function fingerprintKey(key: Buffer): string {
	const digest = createHash("sha256")
		.update(key)
		.digest("base64")
		.replace(/=+$/, "");
	return "SHA256:" + digest;
}

function parseHostKeyAlgorithm(key: Buffer): string | null {
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

function spawnToBuffers(
	bin: string,
	args: string[],
	cwd: string,
): Promise<{ code: number; stdout: Buffer; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(bin, args, { cwd, shell: false, windowsHide: true });
		const out: Buffer[] = [];
		let errText = "";
		child.stdout?.on("data", (d: Buffer) => {
			out.push(Buffer.isBuffer(d) ? d : Buffer.from(d));
		});
		child.stderr?.on("data", (d: Buffer) => {
			errText += d.toString("utf8");
		});
		child.on("error", (e: Error) => {
			const code = (e as NodeJS.ErrnoException).code;
			if (code === "ENOENT") {
				reject(
					new Error(
						bin + " is not installed or not on PATH (spawn " + bin + " ENOENT)",
					),
				);
				return;
			}
			reject(e);
		});
		child.on("close", (code) => {
			resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: errText });
		});
	});
}

function sshReady(client: Client, config: ConnectConfig): Promise<void> {
	return new Promise((resolve, reject) => {
		client.once("ready", () => resolve());
		client.once("error", (err: Error) => reject(err));
		client.connect(config);
	});
}

function execRemote(
	client: Client,
	command: string,
): Promise<{ code: number; output: string }> {
	return new Promise((resolve, reject) => {
		client.exec(command, (err, stream) => {
			if (err) {
				reject(err);
				return;
			}
			let out = "";
			stream.on("data", (d: Buffer) => {
				out += d.toString("utf8");
			});
			stream.stderr.on("data", (d: Buffer) => {
				out += d.toString("utf8");
			});
			stream.on("close", (code: number) => {
				resolve({ code, output: out });
			});
			stream.on("error", (e: Error) => reject(e));
		});
	});
}

function sftpOpen(client: Client): Promise<SFTPWrapper> {
	return new Promise((resolve, reject) => {
		client.sftp((err, sftp) => {
			if (err) reject(err);
			else resolve(sftp);
		});
	});
}

function sftpFastPut(
	sftp: SFTPWrapper,
	localPath: string,
	remotePath: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		sftp.fastPut(localPath, remotePath, (err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}

function sftpWriteFile(
	sftp: SFTPWrapper,
	remotePath: string,
	contents: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		sftp.writeFile(remotePath, contents, (err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}

async function readCapped(fullPath: string): Promise<string | null> {
	try {
		const st = await stat(fullPath);
		const buf = await readFile(fullPath);
		if (st.size > 256 * 1024) {
			return buf.subarray(0, 256 * 1024).toString("utf8");
		}
		return buf.toString("utf8");
	} catch {
		return null;
	}
}

export async function handleRepoDeployJob(
	job: Job<RepoJobData>,
): Promise<void> {
	const { deploymentId } = job.data;

	const deployment = (await Deployment.findById(deploymentId).lean()) as any;
	if (!deployment) throw new Error("Deployment " + deploymentId + " not found");
	if (deployment.status !== "queued") {
		console.log(
			'[worker] repo job skipped — status is "' + deployment.status + '"',
		);
		return;
	}
	if (deployment.kind && deployment.kind !== "repo") {
		throw new Error("Deployment " + deploymentId + " is not a repo deployment");
	}

	const project = (await Project.findById(deployment.projectId).lean()) as any;
	if (!project)
		throw new Error("Project not found for deployment " + deploymentId);
	if (project.kind !== "repo") {
		throw new Error(
			"Project " + String(deployment.projectId) + " is not a repo project",
		);
	}

	const repoUrl: string | undefined =
		project.repo?.url ?? deployment.repoUrl ?? undefined;
	const branch: string =
		project.repo?.branch ?? deployment.repoBranch ?? "main";
	const serverId: string | undefined =
		(deployment.serverId ? String(deployment.serverId) : undefined) ??
		(project.repo?.serverId ? String(project.repo.serverId) : undefined);
	if (!repoUrl)
		throw new Error("Repo URL missing for deployment " + deploymentId);
	if (!serverId)
		throw new Error("Server missing for deployment " + deploymentId);

	const server = (await Server.findById(serverId).lean()) as any;
	if (!server) throw new Error("Server " + serverId + " not found");
	const credential = resolveServerCredential(
		server.credentialEnc,
		env.CLOUDMAN_SECRET,
	);
	const isMock = env.CLOUDMAN_WORKER_MOCK === "1";

	try {
		if (isMock) {
			await recordDeploymentEvent(
				deploymentId,
				{
					level: "info",
					message: "Cloning " + repoUrl + " (branch " + branch + ")... (mock)",
				},
				"initializing",
			);
			await sleep(800);
			await recordDeploymentEvent(
				deploymentId,
				{ level: "progress", message: "Detecting stack... (mock)" },
				"planning",
			);
			await sleep(700);
			const rawStack =
				project.repo?.defaultStack ?? deployment.stack ?? "node-express";
			let mockRecipe = null;
			try {
				mockRecipe = buildRecipe(rawStack as DetectedStack);
			} catch {
				mockRecipe = null;
			}
			const mockArtifacts =
				mockRecipe && artifactPaths(mockRecipe).length > 0
					? [...artifactPaths(mockRecipe)]
					: ["app"];
			await recordDeploymentEvent(deploymentId, {
				level: "progress",
				message:
					"Simulating build (" +
					(mockRecipe?.label ?? String(rawStack)) +
					")... (mock)",
			});
			await sleep(700);
			await recordDeploymentEvent(
				deploymentId,
				{ level: "progress", message: "Simulating apply... (mock)" },
				"applying",
			);
			await sleep(700);

			const preComplete = (await Deployment.findById(deploymentId)
				.select("status")
				.lean()) as any;
			if (preComplete?.status === "canceled") {
				console.log("[worker] repo job aborted — deployment was canceled");
				return;
			}

			const mockPort = mockRecipe?.exposedPort || 3000;
			const mockUrl = "http://" + server.host + ":" + String(mockPort);
			const summary = {
				artifacts: mockArtifacts,
				changed: [],
				created: mockArtifacts.length,
				updated: 0,
				unchanged: 0,
			};
			await Deployment.updateOne(
				{ _id: deploymentId },
				{
					$set: {
						repoPlanSummary: summary,
						commitSha: "mock-sha",
						stack: mockRecipe?.stack ?? String(rawStack),
						url: mockUrl,
						updatedAt: new Date(),
					},
				},
			);
			await recordDeploymentEvent(
				deploymentId,
				{
					level: "success",
					message: "Repo deploy complete (mock) — " + mockUrl,
				},
				"completed",
			);
			return;
		}

		const dir = repoDirFor(deploymentId);
		await rm(dir, { recursive: true, force: true });
		await mkdir(dir, { recursive: true });

		await recordDeploymentEvent(
			deploymentId,
			{
				level: "info",
				message: "Cloning " + repoUrl + " (branch " + branch + ")...",
			},
			"initializing",
		);
		const clone = await spawnToBuffers(
			"git",
			["clone", "--depth", "1", "--branch", branch, repoUrl, dir],
			os.tmpdir(),
		);
		if (clone.code !== 0) {
			throw new Error(
				"git clone failed:\n" +
					tail(clone.stderr || clone.stdout.toString("utf8")),
			);
		}

		const rev = await spawnToBuffers("git", ["rev-parse", "HEAD"], dir);
		if (rev.code !== 0) {
			throw new Error("git rev-parse failed:\n" + tail(rev.stderr));
		}
		const commitSha = rev.stdout.toString("utf8").trim();

		const ls = await spawnToBuffers("git", ["ls-files"], dir);
		if (ls.code !== 0) {
			throw new Error("git ls-files failed:\n" + tail(ls.stderr));
		}
		const files = ls.stdout
			.toString("utf8")
			.split(/\r?\n/)
			.map((s) => s.trim())
			.filter((s) => s.length > 0);

		const view: RepoFileView = {
			paths: files,
			getContent: async (p: string) => {
				if (!p || p.startsWith("/") || p.includes("..")) return null;
				const full = path.join(dir, p);
				if (!full.startsWith(dir)) return null;
				return readCapped(full);
			},
		};

		await recordDeploymentEvent(
			deploymentId,
			{ level: "progress", message: "Detecting stack..." },
			"planning",
		);
		const defaultStack = project.repo?.defaultStack as
			| DetectedStack
			| undefined;
		const detection = await detectStack(
			view,
			defaultStack ? { stack: defaultStack } : {},
		);
		if (detection.stack === "unsupported") {
			throw new Error(
				"Stack unsupported — no build recipe available: " + detection.reason,
			);
		}

		const recipe = buildRecipe(detection.stack);
		if (!recipe) {
			throw new Error(
				'Stack "' +
					detection.stack +
					'" is unsupported — no build recipe available.',
			);
		}

		const shaped = shapePlan({
			repoUrl,
			branch,
			commit: commitSha,
			stack: detection.stack,
			url: null,
		});
		if (!shaped.plan || shaped.error) {
			throw new Error(shaped.error ?? "Failed to shape deploy plan");
		}
		const plan = shaped.plan;
		await recordDeploymentEvent(deploymentId, {
			level: "info",
			message:
				"Detected " +
				recipe.label +
				" — shipping " +
				String(plan.artifacts.length) +
				" artifact(s)",
		});

		const preRemote = (await Deployment.findById(deploymentId)
			.select("status")
			.lean()) as any;
		if (preRemote?.status === "canceled") {
			console.log("[worker] repo job aborted — deployment was canceled");
			return;
		}

		const inclusive = [...artifactPaths(recipe)];
		const archiveArgs =
			inclusive.length === 0 || inclusive.includes(".")
				? ["archive", "HEAD"]
				: ["archive", "HEAD", ...inclusive];
		const archive = await spawnToBuffers("git", archiveArgs, dir);
		if (archive.code !== 0) {
			throw new Error(
				"git archive failed (is git installed and are artifact paths valid?):\n" +
					tail(archive.stderr || archive.stdout.toString("utf8")),
			);
		}
		let tgzBytes: Buffer;
		try {
			tgzBytes = gzipSync(archive.stdout);
		} catch {
			throw new Error("Failed to gzip artifacts (node:zlib)");
		}
		const tgzPath = path.join(workspaceRoot(), "repo-" + deploymentId + ".tgz");
		await writeFile(tgzPath, tgzBytes);

		let observedFp: string | null = null;
		let observedAlgo: string | null = null;
		let mismatch = false;
		const sshConfig: ConnectConfig = {
			host: server.host,
			port: server.port,
			username: server.sshUser,
			timeout: 15_000,
			readyTimeout: 15_000,
			hostVerifier: (key: Buffer) => {
				const fp = fingerprintKey(key);
				observedFp = fp;
				observedAlgo = parseHostKeyAlgorithm(key);
				if (server.knownHostKey) {
					if (fp !== server.knownHostKey) {
						mismatch = true;
						return false;
					}
					return true;
				}
				return true;
			},
		};
		if (server.authMode === "key") sshConfig.privateKey = credential;
		else sshConfig.password = credential;

		await recordDeploymentEvent(
			deploymentId,
			{ level: "progress", message: "Connecting to " + server.host + "..." },
			"applying",
		);
		const client = new Client();
		try {
			await sshReady(client, sshConfig);
		} catch (e) {
			client.end();
			if (mismatch) {
				throw new Error(
					"Host key mismatch (possible MITM) — refusing to deploy",
				);
			}
			throw e;
		}
		if (mismatch) {
			client.end();
			throw new Error("Host key mismatch (possible MITM) — refusing to deploy");
		}
		await recordDeploymentEvent(deploymentId, {
			level: "info",
			message:
				"Host key verified (" +
				(observedAlgo ?? "unknown") +
				" " +
				(observedFp ?? "unknown") +
				")",
		});

		try {
			const remoteAppDir: string = server.remoteAppDir ?? "/srv/cloudman";
			const remoteTgz = remoteAppDir + "/bundle.tgz";

			const mkdirRes = await execRemote(client, "mkdir -p " + sq(remoteAppDir));
			if (mkdirRes.code !== 0) {
				throw new Error("mkdir remoteAppDir failed:\n" + tail(mkdirRes.output));
			}

			const sftp = await sftpOpen(client);
			await sftpFastPut(sftp, tgzPath, remoteTgz);
			const extract = await execRemote(
				client,
				"tar -xzf " + sq(remoteTgz) + " -C " + sq(remoteAppDir),
			);
			if (extract.code !== 0) {
				throw new Error("Remote extract failed:\n" + tail(extract.output));
			}

			const remoteCmds: string[] = [];
			if (recipe.installCommand && recipe.installCommand.trim().length > 0) {
				remoteCmds.push(recipe.installCommand);
			}
			if (recipe.buildCommand && recipe.buildCommand.trim().length > 0) {
				remoteCmds.push(recipe.buildCommand);
			}
			for (const cmd of remoteCmds) {
				await recordDeploymentEvent(deploymentId, {
					level: "progress",
					message: "$ " + cmd,
				});
				const res = await execRemote(
					client,
					"cd " + sq(remoteAppDir) + " && " + cmd,
				);
				const lines = res.output
					.split(/\r?\n/)
					.map((l) => l.trim())
					.filter((l) => l.length > 0)
					.slice(-25);
				for (const line of lines.slice(0, 50)) {
					await recordDeploymentEvent(deploymentId, {
						level: "progress",
						message: line.slice(0, 500),
					});
				}
				if (res.code !== 0) {
					throw new Error(
						"Remote command failed (" + cmd + "):\n" + tail(res.output),
					);
				}
			}

			const port: number = recipe.exposedPort || 80;
			const manifest = renderRuntime(recipe, {
				appName: String(project.name ?? "app"),
				runDir: remoteAppDir,
				runUser: String(server.sshUser ?? "root"),
				port,
				publicHost: String(server.host),
			});
			for (const file of manifest.files) {
				const parent = path.posix.dirname(file.path);
				await execRemote(client, "mkdir -p " + sq(parent));
				await sftpWriteFile(sftp, file.path, file.contents);
			}
			for (const cmd of manifest.commands) {
				await recordDeploymentEvent(deploymentId, {
					level: "progress",
					message: "$ " + cmd,
				});
				const res = await execRemote(client, cmd);
				if (res.code !== 0) {
					throw new Error(
						"Runtime enable failed (" + cmd + "):\n" + tail(res.output),
					);
				}
			}

			const summary = summarize(plan, { commit: null, artifacts: [] }, []);
			const url = "http://" + String(server.host) + ":" + String(port);

			const preComplete = (await Deployment.findById(deploymentId)
				.select("status")
				.lean()) as any;
			if (preComplete?.status === "canceled") {
				console.log("[worker] repo job aborted — deployment was canceled");
				return;
			}

			await Deployment.updateOne(
				{ _id: deploymentId },
				{
					$set: {
						repoPlanSummary: {
							artifacts: [...summary.artifacts],
							changed: [],
							created: summary.created,
							updated: summary.updated,
							unchanged: summary.unchanged,
						},
						commitSha,
						stack: recipe.stack,
						url,
						updatedAt: new Date(),
					},
				},
			);
			await recordDeploymentEvent(
				deploymentId,
				{ level: "success", message: "Repo deploy complete — " + url },
				"completed",
			);
		} finally {
			client.end();
		}
		await rm(tgzPath, { force: true }).catch(() => {});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await Deployment.updateOne(
			{ _id: deploymentId },
			{
				$set: {
					status: "failed",
					error: message.slice(0, 500),
					updatedAt: new Date(),
				},
			},
		);
		await recordDeploymentEvent(
			deploymentId,
			{ level: "error", message: "Repo deploy failed: " + message },
			"failed",
		);
		throw error;
	}
}
