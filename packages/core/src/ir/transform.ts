import { resolveDependencies } from "../graph/dependencies";
import { resolveNodeRefs, sgEffectiveVpc } from "../graph/refs";
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

	const nodeRefs = resolveNodeRefs(graph);
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
			attributes: mapAttributes(node.type, resolved, nodeId, graph, nodeRefs),
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
	nodeId: string,
	graph: InfrastructureGraph,
	nodeRefs: ReturnType<typeof resolveNodeRefs>,
): Record<string, unknown> {
	switch (resourceType) {
		case "aws_ec2": {
			const subnetRef = nodeRefs.get(nodeId)?.subnet;
			const sgRefs = nodeRefs.get(nodeId)?.securityGroups ?? [];
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
				...(subnetRef ? { subnet_ref: subnetRef } : {}),
				...(sgRefs.length > 0 ? { security_group_refs: sgRefs } : {}),
			};
		}
		case "aws_s3":
			return {
				...(typeof config.bucketName === "string" &&
				config.bucketName.length > 0
					? { bucket: config.bucketName }
					: {}),
				versioning: config.versioning,
				force_destroy: config.forceDestroy,
			};
		case "aws_vpc":
			return {
				cidr_block: config.cidrBlock,
				enable_dns_hostnames: config.enableDnsHostnames,
			};
		case "aws_subnet": {
			const vpcRef = nodeRefs.get(nodeId)?.vpc;
			return {
				cidr_block: config.cidrBlock,
				...(typeof config.availabilityZone === "string" &&
				config.availabilityZone.length > 0
					? { availability_zone: config.availabilityZone }
					: {}),
				...(vpcRef ? { vpc_ref: vpcRef } : {}),
			};
		}
		case "aws_security_group": {
			const vpcRef = sgEffectiveVpc(nodeId, graph, nodeRefs);
			return {
				description: config.description,
				ingress_rules: Array.isArray(config.ingressRules)
					? (config.ingressRules as Array<Record<string, unknown>>).map(
							(rule) => ({
								from_port: rule.fromPort,
								to_port: rule.toPort,
								protocol: rule.protocol,
								cidr_block: rule.cidrBlock,
							}),
						)
					: [],
				...(vpcRef ? { vpc_ref: vpcRef } : {}),
			};
		}
		case "aws_dynamodb_table": {
			return {
				hash_key: config.hashKey,
				hash_key_type: config.hashKeyType,
				...(typeof config.rangeKey === "string" && config.rangeKey.length > 0
					? { range_key: config.rangeKey, range_key_type: config.rangeKeyType }
					: {}),
				billing_mode: config.billingMode,
			};
		}
		case "aws_rds": {
			const subnetRefs = nodeRefs.get(nodeId)?.subnets ?? [];
			const sgRefs = nodeRefs.get(nodeId)?.securityGroups ?? [];
			return {
				engine: config.engine,
				...(typeof config.engineVersion === "string" &&
				config.engineVersion.length > 0
					? { engine_version: config.engineVersion }
					: {}),
				instance_class: config.instanceClass,
				allocated_storage_gb: config.allocatedStorageGb,
				db_name: config.dbName,
				username: config.username,
				publicly_accessible: config.publiclyAccessible,
				skip_final_snapshot: config.skipFinalSnapshot,
				subnet_refs: subnetRefs,
				...(sgRefs.length > 0 ? { security_group_refs: sgRefs } : {}),
			};
		}
		default:
			return {};
	}
}
