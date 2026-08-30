import { resolveDependencies } from "../graph/dependencies";
import { consumerVpc, resolveNodeRefs, sgEffectiveVpc } from "../graph/refs";
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
		case "aws_internet_gateway": {
			const vpcRef = nodeRefs.get(nodeId)?.vpc;
			return {
				...(vpcRef ? { vpc_ref: vpcRef } : {}),
			};
		}
		case "aws_nat_gateway": {
			const subnetRef = nodeRefs.get(nodeId)?.subnet;
			return {
				connectivity_type: config.connectivityType,
				...(subnetRef ? { subnet_ref: subnetRef } : {}),
			};
		}
		case "aws_alb": {
			const subnetRefs = nodeRefs.get(nodeId)?.subnets ?? [];
			const sgRefs = nodeRefs.get(nodeId)?.securityGroups ?? [];
			const vpcRef = consumerVpc(nodeId, nodeRefs);
			return {
				scheme: config.scheme,
				listener_port: config.listenerPort,
				listener_protocol: config.listenerProtocol,
				health_check_path: config.healthCheckPath,
				internal: config.scheme === "internal",
				target_refs: nodeRefs.get(nodeId)?.lbTargets ?? [],
				subnet_refs: subnetRefs,
				...(sgRefs.length > 0 ? { security_group_refs: sgRefs } : {}),
				...(vpcRef ? { vpc_ref: vpcRef } : {}),
			};
		}
		case "aws_ecr":
			return {
				scan_on_push: config.scanOnPush,
				image_tag_mutability: config.tagMutability,
			};
		case "aws_lambda": {
			const refs = nodeRefs.get(nodeId);
			const subnetRefs = refs?.subnets ?? [];
			const sgRefs = refs?.securityGroups ?? [];
			return {
				code_source: config.codeSource,
				runtime: config.runtime,
				handler: config.handler,
				memory_size: config.memoryMb,
				timeout: config.timeoutSec,
				...(typeof config.s3CodeBucket === "string"
					? { s3_bucket: config.s3CodeBucket }
					: {}),
				...(typeof config.s3CodeKey === "string"
					? { s3_key: config.s3CodeKey }
					: {}),
				...(refs?.iamRole ? { iam_role_ref: refs.iamRole } : {}),
				...(refs && refs.repositories.length > 0
					? { repository_refs: refs.repositories }
					: {}),
				...(subnetRefs.length > 0 ? { subnet_refs: subnetRefs } : {}),
				...(sgRefs.length > 0 ? { security_group_refs: sgRefs } : {}),
			};
		}
		case "aws_ecs": {
			const refs = nodeRefs.get(nodeId);
			return {
				cpu: config.cpu,
				memory: config.memory,
				container_port: config.containerPort,
				desired_count: config.desiredCount,
				image_tag: config.imageTag,
				assign_public_ip: config.assignPublicIp,
				...(typeof config.image === "string" && config.image.length > 0
					? { image: config.image }
					: {}),
				...(refs?.iamRole ? { iam_role_ref: refs.iamRole } : {}),
				...(refs && refs.repositories.length > 0
					? { repository_refs: refs.repositories }
					: {}),
				...(refs && refs.subnets.length > 0
					? { subnet_refs: refs.subnets }
					: {}),
				...(refs && refs.securityGroups.length > 0
					? { security_group_refs: refs.securityGroups }
					: {}),
			};
		}
		case "aws_ebs": {
			const instanceRef = nodeRefs.get(nodeId)?.instanceRef;
			return {
				size_gb: config.sizeGb,
				volume_type: config.type,
				device: config.device,
				encrypted: config.encrypted,
				...(typeof config.iops === "number" ? { iops: config.iops } : {}),
				...(instanceRef ? { instance_ref: instanceRef } : {}),
			};
		}
		case "aws_efs": {
			const subnetRefs = nodeRefs.get(nodeId)?.subnets ?? [];
			const sgRefs = nodeRefs.get(nodeId)?.securityGroups ?? [];
			return {
				performance_mode: config.performanceMode,
				throughput_mode: config.throughputMode,
				encrypted: config.encrypted,
				subnet_refs: subnetRefs,
				...(sgRefs.length > 0 ? { security_group_refs: sgRefs } : {}),
			};
		}
		case "aws_aurora": {
			const subnetRefs = nodeRefs.get(nodeId)?.subnets ?? [];
			const sgRefs = nodeRefs.get(nodeId)?.securityGroups ?? [];
			return {
				engine: config.engine,
				...(typeof config.engineVersion === "string" &&
				config.engineVersion.length > 0
					? { engine_version: config.engineVersion }
					: {}),
				instance_class: config.instanceClass,
				db_name: config.dbName,
				db_username: config.dbUsername,
				subnet_refs: subnetRefs,
				...(sgRefs.length > 0 ? { security_group_refs: sgRefs } : {}),
			};
		}
		case "aws_elasticache": {
			const subnetRefs = nodeRefs.get(nodeId)?.subnets ?? [];
			const sgRefs = nodeRefs.get(nodeId)?.securityGroups ?? [];
			const engine = config.engine === "memcached" ? "memcached" : "redis";
			return {
				engine,
				node_type: config.nodeType,
				num_cache_nodes: config.numCacheNodes,
				port:
					typeof config.port === "number"
						? config.port
						: engine === "memcached"
							? 11211
							: 6379,
				...(typeof config.parameterGroupName === "string" &&
				config.parameterGroupName.length > 0
					? { parameter_group_name: config.parameterGroupName }
					: engine === "memcached"
						? { parameter_group_name: "default.memcached1.6" }
						: { parameter_group_name: "default.redis7" }),
				subnet_refs: subnetRefs,
				...(sgRefs.length > 0 ? { security_group_refs: sgRefs } : {}),
			};
		}
		case "aws_iam_role":
			return {
				assume_service: config.assumeService,
				...(typeof config.name === "string" && config.name.length > 0
					? { role_name: config.name }
					: {}),
			};
		case "aws_iam_policy":
			return {
				...(typeof config.name === "string" && config.name.length > 0
					? { policy_name: config.name }
					: {}),
				actions: config.actions,
				resources: config.resources,
				role_refs: nodeRefs.get(nodeId)?.roles ?? [],
			};
		case "aws_sqs":
			return {
				visibility_timeout_seconds: config.visibilityTimeoutSec,
				delay_seconds: config.delaySeconds,
				fifo_queue: config.fifo,
			};
		case "aws_sns":
			return {
				...(typeof config.displayName === "string" &&
				config.displayName.length > 0
					? { display_name: config.displayName }
					: {}),
			};
		case "aws_route53_zone": {
			const vpcRef = nodeRefs.get(nodeId)?.vpc;
			return {
				zone_name: config.zoneName,
				private_zone: config.privateZone,
				...(vpcRef ? { vpc_ref: vpcRef } : {}),
			};
		}
		case "aws_route53_record": {
			const zoneRef = nodeRefs.get(nodeId)?.zone;
			const aliasRef = nodeRefs.get(nodeId)?.albAlias;
			return {
				record_name: config.recordName,
				record_type: config.recordType,
				ttl: config.ttl,
				records: config.records,
				...(zoneRef ? { zone_ref: zoneRef } : {}),
				...(aliasRef ? { alias_ref: aliasRef } : {}),
			};
		}
		case "aws_cloudwatch_log_group":
			return {
				retention_days: config.retentionDays,
			};
		case "aws_apigateway": {
			const lambdaRefs = nodeRefs.get(nodeId)?.targetFunctions ?? [];
			return {
				stage_name: config.stageName,
				route_path: config.routePath,
				http_method: config.httpMethod,
				...(lambdaRefs.length > 0 ? { lambda_refs: lambdaRefs } : {}),
			};
		}
		default:
			return {};
	}
}
