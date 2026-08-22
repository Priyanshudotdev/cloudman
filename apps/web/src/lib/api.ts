import { env } from "@my-better-t-app/env/web";

export interface ValidationIssueDto {
	code: string;
	message: string;
	path?: { kind: "node" | "edge"; id: string };
}

export class ApiError extends Error {
	status: number;
	issues?: ValidationIssueDto[];

	constructor(status: number, message: string, issues?: ValidationIssueDto[]) {
		super(message);
		this.status = status;
		this.issues = issues;
	}
}

export const apiUrl = env.NEXT_PUBLIC_API_URL;

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${apiUrl}${path}`, {
		...init,
		credentials: "include",
		headers: {
			"Content-Type": "application/json",
			...(init?.headers ?? {}),
		},
	});

	const body = await response.json().catch(() => ({}));

	if (!response.ok) {
		const payload = body as { error?: string; issues?: ValidationIssueDto[] };
		throw new ApiError(
			response.status,
			payload.error ?? `Request failed (${response.status})`,
			payload.issues,
		);
	}

	return body as T;
}

export interface ProjectDto {
	_id: string;
	name: string;
	description: string;
	ownerUserId: string;
	latestGraphVersion: number;
	createdAt: string;
	updatedAt: string;
}

export interface GraphVersionSummaryDto {
	_id: string;
	version: number;
	createdAt: string;
}

export interface GraphVersionDto extends GraphVersionSummaryDto {
	projectId: string;
	graph: Record<string, unknown>;
}

export interface DeploymentResourceDto {
	address: string;
	action: string;
	name?: string;
}

export interface AwsConnectionDto {
	_id: string;
	userId: string;
	label: string;
	roleArn: string;
	region: string;
	createdAt: string;
}

export interface DeploymentDto {
	_id: string;
	projectId: string;
	graphVersionId: string;
	status: string;
	action?: "provision" | "destroy";
	region?: string;
	planSummary?: {
		create: number;
		update: number;
		destroy: number;
		resources: DeploymentResourceDto[];
	};
	startedAt?: string;
	completedAt?: string;
	createdAt: string;
}

export interface CompileResultDto {
	stats: { resources: number; files: number; bytes: number };
	files: Array<{ path: string; contents: string }>;
}
