import type { ProjectDto } from "@/lib/api";
import { api } from "@/lib/api";

// ---------------------------------------------------------------------------
// Servers
// GET /api/servers -> 200 { servers }
// POST /api/servers -> 201 { server }
// PUT /api/servers/:id -> 200 { server }
// DELETE /api/servers/:id -> 200 { ok: true }
// POST /api/servers/:id/verify -> 200 { ok: true, user, hostname }
//   | 502 { ok: false, error } (surfaced as an ApiError throw)
// ---------------------------------------------------------------------------

export type ServerAuthMode = "key" | "password";

export interface ServerDto {
	_id: string;
	userId: string;
	label: string;
	host: string;
	port: number;
	sshUser: string;
	authMode: ServerAuthMode;
	remoteAppDir: string;
	/** Set after a successful verify. Absent until the first verify. */
	verifiedAt?: string;
	/** Rendered when present; secrets are never returned by the API. */
	hostKeyFingerprint?: string;
	createdAt: string;
	updatedAt: string;
}

export interface CreateServerInput {
	label: string;
	host: string;
	port?: number;
	sshUser?: string;
	authMode?: ServerAuthMode;
	/** PEM private key (authMode "key") or password (authMode "password"). */
	credential: string;
	remoteAppDir?: string;
}

export type UpdateServerInput = Partial<CreateServerInput>;

export interface VerifyServerResult {
	ok: boolean;
	user?: string;
	hostname?: string;
	fingerprint?: string;
	error?: string;
}

export async function listServers(): Promise<ServerDto[]> {
	const result = await api<{ servers: ServerDto[] }>("/api/servers");
	return result.servers;
}

export async function createServer(
	input: CreateServerInput,
): Promise<ServerDto> {
	const result = await api<{ server: ServerDto }>("/api/servers", {
		method: "POST",
		body: JSON.stringify(input),
	});
	return result.server;
}

export async function updateServer(
	id: string,
	patch: UpdateServerInput,
): Promise<ServerDto> {
	const result = await api<{ server: ServerDto }>(`/api/servers/${id}`, {
		method: "PUT",
		body: JSON.stringify(patch),
	});
	return result.server;
}

export async function deleteServer(id: string): Promise<void> {
	await api<{ ok: boolean }>(`/api/servers/${id}`, { method: "DELETE" });
}

export async function verifyServer(id: string): Promise<VerifyServerResult> {
	return api<VerifyServerResult>(`/api/servers/${id}/verify`, {
		method: "POST",
		body: JSON.stringify({}),
	});
}

// ---------------------------------------------------------------------------
// Repo deployments
// GET /api/repo-deployments -> 200 { deployments } (kind "repo", no events)
// POST /api/repo-deployments -> 201 { deployment }
// POST /api/repo-deployments/:id/retry -> 200 { ok: true, status: "queued" }
//   (409 unless status is failed/canceled)
// POST /api/repo-deployments/:id/cancel -> 200 { ok: true, status: "canceled" }
//   (409 unless status is queued/initializing/planning)
// GET /api/deployments/:id -> 200 { deployment } (full record incl. events tail)
// ---------------------------------------------------------------------------

export interface RepoDeploymentEventDto {
	at: string;
	level: "info" | "success" | "error" | "progress";
	message: string;
	status?: string;
	data?: unknown;
}

export interface RepoPlanSummaryDto {
	artifacts: string[];
	changed: string[];
	created: number;
	updated: number;
	unchanged: number;
}

export interface RepoDeploymentDto {
	_id: string;
	projectId: string;
	kind: "repo";
	status: string;
	action?: "provision" | "destroy";
	serverId?: string;
	repoUrl?: string;
	repoBranch?: string;
	commitSha?: string;
	/** Detected stack for the deployed commit. */
	stack?: string;
	/** URL the app is reachable at after a successful deploy. */
	url?: string;
	repoPlanSummary?: RepoPlanSummaryDto;
	events?: RepoDeploymentEventDto[];
	error?: string;
	startedAt?: string;
	completedAt?: string;
	createdAt: string;
	updatedAt: string;
}

export interface CreateRepoDeploymentInput {
	projectId: string;
	repoUrl?: string;
	repoBranch?: string;
	serverId?: string;
	commitSha?: string;
}

export const REPO_TERMINAL_STATUSES = new Set([
	"completed",
	"failed",
	"canceled",
]);

export const RETRYABLE_REPO_STATUSES = new Set(["failed", "canceled"]);

export const CANCELLABLE_REPO_STATUSES = new Set([
	"queued",
	"initializing",
	"planning",
]);

export async function listRepoDeployments(): Promise<RepoDeploymentDto[]> {
	const result = await api<{ deployments: RepoDeploymentDto[] }>(
		"/api/repo-deployments",
	);
	return result.deployments;
}

export async function createRepoDeployment(
	input: CreateRepoDeploymentInput,
): Promise<RepoDeploymentDto> {
	const result = await api<{ deployment: RepoDeploymentDto }>(
		"/api/repo-deployments",
		{
			method: "POST",
			body: JSON.stringify(input),
		},
	);
	return result.deployment;
}

export async function retryRepoDeployment(id: string): Promise<void> {
	await api<{ ok: boolean; status: string }>(
		`/api/repo-deployments/${id}/retry`,
		{
			method: "POST",
			body: JSON.stringify({}),
		},
	);
}

export async function cancelRepoDeployment(id: string): Promise<void> {
	await api<{ ok: boolean; status: string }>(
		`/api/repo-deployments/${id}/cancel`,
		{
			method: "POST",
			body: JSON.stringify({}),
		},
	);
}

export async function getRepoDeployment(
	id: string,
): Promise<RepoDeploymentDto> {
	const result = await api<{ deployment: RepoDeploymentDto }>(
		`/api/deployments/${id}`,
	);
	return result.deployment;
}

// ---------------------------------------------------------------------------
// Repo projects
// POST /api/projects { kind: "repo", ... } -> 201 { project }
//   (repoUrl required; repoBranch defaults to "main"; serverId optional inline)
// PUT /api/projects/:id/repo-config -> 200 { project }
// ---------------------------------------------------------------------------

export interface RepoConfigDto {
	url: string;
	branch: string;
	defaultStack?: string;
	serverId?: string;
}

export interface RepoProjectDto extends ProjectDto {
	kind: "infra" | "repo";
	repo?: RepoConfigDto;
}

export interface CreateRepoProjectInput {
	name: string;
	repoUrl: string;
	repoBranch?: string;
	defaultStack?: string;
	serverId?: string;
	description?: string;
}

export interface UpdateRepoConfigInput {
	repoUrl?: string;
	repoBranch?: string;
	defaultStack?: string;
	serverId?: string;
}

export async function createRepoProject(
	input: CreateRepoProjectInput,
): Promise<RepoProjectDto> {
	const result = await api<{ project: RepoProjectDto }>("/api/projects", {
		method: "POST",
		body: JSON.stringify({
			kind: "repo",
			name: input.name,
			description: input.description ?? "",
			repoUrl: input.repoUrl,
			...(input.repoBranch ? { repoBranch: input.repoBranch } : {}),
			...(input.defaultStack ? { defaultStack: input.defaultStack } : {}),
			...(input.serverId ? { serverId: input.serverId } : {}),
		}),
	});
	return result.project;
}

export async function updateRepoConfig(
	projectId: string,
	patch: UpdateRepoConfigInput,
): Promise<RepoProjectDto> {
	const result = await api<{ project: RepoProjectDto }>(
		`/api/projects/${projectId}/repo-config`,
		{
			method: "PUT",
			body: JSON.stringify(patch),
		},
	);
	return result.project;
}

export async function getRepoProject(
	projectId: string,
): Promise<RepoProjectDto> {
	const result = await api<{ project: RepoProjectDto }>(
		`/api/projects/${projectId}`,
	);
	return result.project;
}
