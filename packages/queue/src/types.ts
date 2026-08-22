export const INFRA_PLAN_QUEUE = "infra-plan";
export const INFRA_APPLY_QUEUE = "infra-apply";

export interface InfraPlanJobData {
	deploymentId: string;
}

export interface InfraApplyJobData {
	deploymentId: string;
}
