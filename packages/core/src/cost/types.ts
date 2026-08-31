export interface CostEstimate {
	/** Estimated monthly USD total (indicative, us-east-1 list prices). */
	monthly: number;
	/** Human-readable notes explaining what drives the estimate. */
	notes: string[];
}

export interface ResourceCostRow extends CostEstimate {
	irId: string;
	kind: string;
	label: string;
	/** Fraction of the monthly total attributed to this resource. */
	share: number;
}

export interface CostReport {
	monthlyTotal: number;
	resources: ResourceCostRow[];
	/** irIds of the resources that make up the bulk of the bill. */
	topSpenders: string[];
}

export type RiskSeverity = "low" | "medium" | "high";

export interface ResourceRisk {
	irId: string;
	kind: string;
	label: string;
	severity: RiskSeverity;
	code: string;
	message: string;
}
