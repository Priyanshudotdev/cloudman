export const INFRA_PLAN_QUEUE = "infra-plan";
export const INFRA_APPLY_QUEUE = "infra-apply";
export const MAINTENANCE_QUEUE = "infra-maintenance";

export interface InfraPlanJobData {
	deploymentId: string;
}

export interface InfraApplyJobData {
	deploymentId: string;
}

export type MaintenanceJobData = {
	kind: "cleanup-workspace";
	projectId: string;
};
