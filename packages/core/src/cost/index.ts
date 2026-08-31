import type { IRDocument, IRResource } from "../ir/schema";
import { estimateResource } from "./pricing";
import { analyzeRisks } from "./risk";
import type { CostReport, ResourceCostRow } from "./types";

export function roundMoney(value: number): number {
	return Math.round(value * 100) / 100;
}

/** Builds a per-resource cost report, sorted by row total descending. */
export function estimateCost(document: IRDocument): CostReport {
	const rows: ResourceCostRow[] = document.resources.map(
		(resource: IRResource) => {
			const { monthly, notes } = estimateResource(resource);
			return {
				irId: resource.irId,
				kind: resource.kind,
				label: resource.label ?? resource.irId,
				monthly,
				notes,
				share: 0,
			};
		},
	);

	const monthlyTotal = roundMoney(
		rows.reduce((sum, row) => sum + row.monthly, 0),
	);

	for (const row of rows) {
		row.share = monthlyTotal > 0 ? roundMoney(row.monthly / monthlyTotal) : 0;
	}

	rows.sort((l, r) => r.monthly - l.monthly);

	const threshold = monthlyTotal * 0.1;
	const topSpenders = rows
		.filter((row) => row.monthly >= threshold && row.monthly > 0)
		.map((row) => row.irId);

	return { monthlyTotal, resources: rows, topSpenders };
}

export type {
	CostEstimate,
	CostReport,
	ResourceCostRow,
	ResourceRisk,
	RiskSeverity,
} from "./types";
export { analyzeRisks, estimateResource };
