import { resolveDependencies } from "../graph/dependencies";
import type { InfrastructureGraph } from "../graph/schema";
import { infrastructureGraphSchema } from "../graph/schema";
import type { ValidationIssue } from "../graph/validate";
import { validateGraph } from "../graph/validate";
import { getResourceDefinition } from "../registry";
import type { IRDocument, IRResource } from "./schema";

export const DEFAULT_REGION = "us-east-1";

export function sanitizeTofuName(rawId: string): string {
	let name = rawId.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
	if (/^[0-9]/.test(name)) name = `r-${name}`;
	return name;
}

function uniqueNames(ids: string[]): Map<string, string> {
	const used = new Set<string>();
	const result = new Map<string, string>();
	for (const id of ids) {
		const base = sanitizeTofuName(id);
		let candidate = base;
		let counter = 2;
		while (used.has(candidate)) {
			candidate = `${base}-${counter}`;
			counter += 1;
		}
		used.add(candidate);
		result.set(id, candidate);
	}
	return result;
}

export type IRBuildResult =
	| { ok: true; document: IRDocument }
	| { ok: false; issues: ValidationIssue[] };

export interface BuildIROptions {
	region?: string;
}

export function buildIR(
	input: unknown,
	options: BuildIROptions = {},
): IRBuildResult {
	const validation = validateGraph(input);
	if (!validation.valid) {
		return { ok: false, issues: validation.issues };
	}
	// Re-parse so schema defaults (e.g. missing `config` objects) are materialized
	// before transformation — the raw input may omit optional fields.
	const graph: InfrastructureGraph = infrastructureGraphSchema.parse(input);

	const resolution = resolveDependencies(graph);
	const orderedIds = resolution.ok
		? resolution.order
		: graph.nodes.map((n) => n.id);

	const names = uniqueNames(graph.nodes.map((n) => n.id));
	const nodeIds = new Set(graph.nodes.map((n) => n.id));

	const resources: IRResource[] = [];
	for (const nodeId of orderedIds) {
		const node = graph.nodes.find((n) => n.id === nodeId);
		if (!node) continue;
		const definition = getResourceDefinition(node.type);
		if (!definition) continue;

		let resolved: Record<string, unknown>;
		try {
			resolved = definition.resolveConfig(node.config);
		} catch (error) {
			return {
				ok: false,
				issues: [
					{
						code: "INVALID_CONFIG",
						message: `config for "${nodeId}" failed to resolve: ${error instanceof Error ? error.message : String(error)}`,
						path: { kind: "node", id: nodeId },
					},
				],
			};
		}

		resources.push({
			irId: nodeId,
			kind: definition.tofuKind,
			name: names.get(nodeId) ?? nodeId,
			label: node.label ?? definition.label,
			attributes: mapAttributes(node.type, resolved),
			dependsOn: graph.edges
				.filter((edge) => edge.source === nodeId && nodeIds.has(edge.target))
				.map((edge) => edge.target),
		});
	}

	return {
		ok: true,
		document: {
			version: 1,
			name: graph.name,
			region: options.region ?? DEFAULT_REGION,
			resources,
		},
	};
}

function mapAttributes(
	resourceType: string,
	config: Record<string, unknown>,
): Record<string, unknown> {
	switch (resourceType) {
		case "aws_ec2":
			return {
				instance_type: config.instanceType,
				...(typeof config.ami === "string" && config.ami.length > 0
					? { ami: config.ami }
					: {}),
				...(typeof config.keyPairName === "string" &&
				config.keyPairName.length > 0
					? { key_name: config.keyPairName }
					: {}),
				volume_size_gb: config.volumeSizeGb,
			};
		case "aws_s3":
			return {
				...(typeof config.bucketName === "string" &&
				config.bucketName.length > 0
					? { bucket: config.bucketName }
					: {}),
				versioning: config.versioning,
				force_destroy: config.forceDestroy,
			};
		default:
			return {};
	}
}
