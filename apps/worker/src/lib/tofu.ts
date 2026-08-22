import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { env } from "@my-better-t-app/env/worker";

const TOFU_VERSION = "1.9.0";

export interface TofuRunOptions {
	cwd: string;
	env?: Record<string, string>;
	onLine?: (line: string) => void;
	/** Hard limit in milliseconds — the process is killed when exceeded. */
	timeoutMs?: number;
}

export interface TofuRunResult {
	code: number;
	output: string;
	timedOut: boolean;
}

function lineSplitter(onLine?: (line: string) => void) {
	let buffer = "";
	return (chunk: string) => {
		buffer += chunk;
		const lines = buffer.split(/\r?\n/);
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			if (line.trim().length > 0) onLine?.(line);
		}
	};
}

/** Spawns the tofu binary, streaming combined stdout/stderr lines to onLine. */
export function runTofu(
	binaryPath: string,
	args: string[],
	options: TofuRunOptions,
): Promise<TofuRunResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(binaryPath, args, {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
			windowsHide: true,
		});

		let output = "";
		let timedOut = false;
		const handle = lineSplitter(options.onLine);

		let timer: NodeJS.Timeout | undefined;
		const timeoutMs = options.timeoutMs;
		if (timeoutMs && timeoutMs > 0) {
			timer = setTimeout(() => {
				timedOut = true;
				options.onLine?.(
					`cloudman: command exceeded ${Math.round(timeoutMs / 1000)}s — killing process`,
				);
				child.kill();
			}, timeoutMs);
		}

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			output += chunk;
			handle(chunk);
		});
		child.stderr.on("data", (chunk: string) => {
			output += chunk;
			handle(chunk);
		});

		child.on("error", (error) => {
			if (timer) clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			if (timer) clearTimeout(timer);
			resolve({ code: code ?? 1, output, timedOut });
		});
	});
}

async function commandExists(candidate: string): Promise<boolean> {
	try {
		const probe = await runTofu(candidate, ["version"], { cwd: os.tmpdir() });
		return probe.code === 0;
	} catch {
		return false;
	}
}

async function autoInstallTofu(): Promise<string> {
	if (env.CLOUDMAN_TOFU_AUTOINSTALL !== "1") {
		throw new Error(
			"OpenTofu binary not found. Install it, set TOFU_PATH, or enable CLOUDMAN_TOFU_AUTOINSTALL=1.",
		);
	}

	const installDir = path.join(os.homedir(), ".cloudman", "bin");
	const binaryPath = path.join(installDir, "tofu.exe");

	if (
		await stat(binaryPath).then(
			() => true,
			() => false,
		)
	) {
		if (await commandExists(binaryPath)) return binaryPath;
	}

	console.log(`[worker] downloading OpenTofu v${TOFU_VERSION}...`);
	const url = `https://github.com/opentofu/opentofu/releases/download/v${TOFU_VERSION}/tofu_${TOFU_VERSION}_windows_amd64.zip`;
	const response = await fetch(url);
	if (!response.ok || !response.body) {
		throw new Error(
			`Failed to download OpenTofu (${response.status}) from ${url}`,
		);
	}
	const zipBody = response.body;

	await mkdir(installDir, { recursive: true });
	const zipPath = path.join(os.tmpdir(), `tofu-${TOFU_VERSION}.zip`);
	await import("node:stream/promises").then((sp) =>
		sp.pipeline(zipBody, createWriteStream(zipPath)),
	);

	const extractDir = path.join(os.tmpdir(), `tofu-extract-${TOFU_VERSION}`);
	await rm(extractDir, { recursive: true, force: true });
	await new Promise<void>((resolve, reject) => {
		const ps = spawn(
			"powershell.exe",
			[
				"-NoProfile",
				"-Command",
				`Expand-Archive -Force -LiteralPath '${zipPath}' -DestinationPath '${extractDir}'`,
			],
			{ stdio: "ignore" },
		);
		ps.on("close", (code) =>
			code === 0
				? resolve()
				: reject(new Error(`Expand-Archive exited ${code}`)),
		);
		ps.on("error", reject);
	});

	await rename(path.join(extractDir, "tofu.exe"), binaryPath);
	console.log(`[worker] OpenTofu installed at ${binaryPath}`);
	return binaryPath;
}

/** Locates a usable tofu binary: TOFU_PATH → PATH → optional auto-install. */
export async function resolveTofuBinary(): Promise<string> {
	if (env.TOFU_PATH) {
		if (!(await commandExists(env.TOFU_PATH))) {
			throw new Error(`TOFU_PATH is set but not executable: ${env.TOFU_PATH}`);
		}
		return env.TOFU_PATH;
	}
	if (await commandExists("tofu")) return "tofu";
	return autoInstallTofu();
}
