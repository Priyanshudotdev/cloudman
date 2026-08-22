import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CompiledFile } from "@my-better-t-app/core";
import { env } from "@my-better-t-app/env/worker";

function workspaceRoot(): string {
	return (
		env.CLOUDMAN_WORKSPACE_ROOT ?? path.join(os.tmpdir(), "cloudman-workspaces")
	);
}

export function workspacePath(deploymentId: string): string {
	return path.join(workspaceRoot(), deploymentId);
}

export async function prepareWorkspace(
	deploymentId: string,
	files: CompiledFile[],
): Promise<string> {
	const dir = workspacePath(deploymentId);
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });
	for (const file of files) {
		const target = path.join(dir, file.path);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, file.contents, "utf8");
	}
	return dir;
}

export function planFilePath(deploymentId: string): string {
	return path.join(workspacePath(deploymentId), "tfplan.bin");
}

export async function cleanupWorkspace(deploymentId: string): Promise<void> {
	await rm(workspacePath(deploymentId), { recursive: true, force: true });
}
