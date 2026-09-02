export const INFRA_PLAN_QUEUE = "infra-plan";
export const INFRA_APPLY_QUEUE = "infra-apply";
export const MAINTENANCE_QUEUE = "infra-maintenance";
export const REPO_QUEUE = "repo-deploy";

export interface InfraPlanJobData {
	deploymentId: string;
}

export interface InfraApplyJobData {
	deploymentId: string;
}

/** Payload for a git-repo deploy (kind=repo deployment). */
export interface RepoJobData {
	deploymentId: string;
}

export type MaintenanceJobData = {
	kind: "cleanup-workspace";
	projectId: string;
};
