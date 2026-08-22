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

/**
 * Workspaces are keyed by PROJECT so OpenTofu state persists across
 * deployments and remains available for later destroy operations.
 */
export function workspacePath(projectId: string): string {
	return path.join(workspaceRoot(), projectId);
}

/**
 * Writes/overwrites the generated configuration while preserving
 * existing state files (terraform.tfstate, plans, .terraform).
 */
export async function prepareWorkspace(
	projectId: string,
	files: CompiledFile[],
): Promise<string> {
	const dir = workspacePath(projectId);
	await mkdir(dir, { recursive: true });
	for (const file of files) {
		const target = path.join(dir, file.path);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, file.contents, "utf8");
	}
	return dir;
}

export function planFilePath(projectId: string): string {
	return path.join(workspacePath(projectId), "tfplan.bin");
}

/** Full removal — only safe after a successful destroy (state is gone anyway). */
export async function cleanupWorkspace(projectId: string): Promise<void> {
	await rm(workspacePath(projectId), { recursive: true, force: true });
}
