import { env } from "@my-better-t-app/env/web";
import type { GraphJson } from "@/lib/graph-types";

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

export interface DeploymentEventDto {
	at: string;
	level: "info" | "success" | "error" | "progress";
	message: string;
	status?: string;
	data?: unknown;
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
	events?: DeploymentEventDto[];
	startedAt?: string;
	completedAt?: string;
	error?: string;
	createdAt: string;
}

export interface CostResourceDto {
	irId: string;
	kind: string;
	label: string;
	monthly: number;
	notes: string[];
	share: number;
}

export interface CostReportDto {
	monthlyTotal: number;
	resources: CostResourceDto[];
	topSpenders: string[];
}

export interface RiskDto {
	irId: string;
	kind: string;
	label: string;
	severity: "low" | "medium" | "high";
	code: string;
	message: string;
}

export interface CompileResultDto {
	stats: { resources: number; files: number; bytes: number };
	files: Array<{ path: string; contents: string }>;
	cost: CostReportDto;
	risks: RiskDto[];
}

export interface GenerateResultDto {
	blueprint: string | null;
	mode: "engine" | "llm";
	graph: GraphJson;
	warnings: string[];
}

export interface AnalyticsStatsDto {
	stats: {
		projects: number;
		deployments: number;
		completed: number;
		failed: number;
		successRate: number | null;
		resourcesManaged: number;
	};
}
