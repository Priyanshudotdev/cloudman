import { ZodError } from "zod";

import { getResourceDefinition } from "../registry";
import { cidrContains } from "./cidr";
import { resolveDependencies } from "./dependencies";
import { consumerVpc, resolveNodeRefs, sgEffectiveVpc } from "./refs";
import {
	type GraphEdge,
	type GraphNode,
	type InfrastructureGraph,
	infrastructureGraphSchema,
} from "./schema";

export interface ValidationIssuePath {
	kind: "node" | "edge";
	id: string;
}
export interface ValidationIssue {
	code: string;
	message: string;
	path?: ValidationIssuePath;
}

export interface GraphValidationResult {
	valid: boolean;
	issues: ValidationIssue[];
}

function zodIssuesToValidationIssues(error: ZodError): ValidationIssue[] {
	return error.issues.map((issue) => ({
		code: "INVALID_GRAPH_SHAPE",
		message: `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`,
	}));
}

export function validateGraph(input: unknown): GraphValidationResult {
	const parsed = infrastructureGraphSchema.safeParse(input);
	if (!parsed.success) {
		return { valid: false, issues: zodIssuesToValidationIssues(parsed.error) };
	}
	const graph: InfrastructureGraph = parsed.data;
	const issues: ValidationIssue[] = [];

	const seenIds = new Set<string>();
	for (const node of graph.nodes) {
		if (seenIds.has(node.id)) {
			issues.push({
				code: "DUPLICATE_NODE_ID",
				message: `node id "${node.id}" is used more than once`,
				path: { kind: "node", id: node.id },
			});
			continue;
		}
		seenIds.add(node.id);
	}

	const firstNodeById = new Map<string, GraphNode>();
	for (const node of graph.nodes) {
		if (!firstNodeById.has(node.id)) firstNodeById.set(node.id, node);
	}

	for (const [nodeId, node] of firstNodeById) {
		const definition = getResourceDefinition(node.type);
		if (!definition) {
			issues.push({
				code: "UNKNOWN_RESOURCE_TYPE",
				message: `"${node.type}" is not a supported resource type`,
				path: { kind: "node", id: nodeId },
			});
			continue;
		}
		try {
			definition.resolveConfig(node.config);
		} catch (error) {
			if (error instanceof ZodError) {
				for (const issue of error.issues) {
					const field = issue.path.map(String).join(".");
					issues.push({
						code: "INVALID_CONFIG",
						message: `${definition.label} "${nodeId}" has invalid config${field ? ` at "${field}"` : ""}: ${issue.message}`,
						path: { kind: "node", id: nodeId },
					});
				}
			} else {
				issues.push({
					code: "INVALID_CONFIG",
					message: `${definition.label} "${nodeId}" config could not be resolved`,
					path: { kind: "node", id: nodeId },
				});
			}
		}
	}

	const edgeSignatures = new Set<string>();
	for (const edge of graph.edges as GraphEdge[]) {
		if (!firstNodeById.has(edge.source)) {
			issues.push({
				code: "EDGE_UNKNOWN_NODE",
				message: `edge references unknown source node "${edge.source}"`,
				path: { kind: "edge", id: edge.id ?? `${edge.source}->${edge.target}` },
			});
		}
		if (!firstNodeById.has(edge.target)) {
			issues.push({
				code: "EDGE_UNKNOWN_NODE",
				message: `edge references unknown target node "${edge.target}"`,
				path: { kind: "edge", id: edge.id ?? `${edge.source}->${edge.target}` },
			});
		}
		if (edge.source === edge.target) {
			issues.push({
				code: "EDGE_SELF_LOOP",
				message: `node "${edge.source}" cannot depend on itself`,
				path: { kind: "edge", id: edge.id ?? `${edge.source}->${edge.target}` },
			});
		}
		const signature = `${edge.source}->${edge.target}`;
		if (edgeSignatures.has(signature)) {
			issues.push({
				code: "DUPLICATE_EDGE",
				message: `duplicate connection ${signature}`,
				path: { kind: "edge", id: signature },
			});
		}
		edgeSignatures.add(signature);
	}

	const dependencyResolution = resolveDependencies(graph);
	if (!dependencyResolution.ok) {
		issues.push({
			code: "GRAPH_CYCLE",
			message: `circular dependency between: ${dependencyResolution.cycle.join(", ")}`,
		});
	}

	issues.push(...validateNetworking(graph, firstNodeById));

	return { valid: issues.length === 0, issues };
}

/** Resolves + applies defaults to a node's config, tolerating invalid configs. */
function resolvedConfigOf(node: GraphNode): Record<string, unknown> | undefined {
	const definition = getResourceDefinition(node.type);
	if (!definition) return undefined;
	try {
		return definition.resolveConfig(node.config) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

/** Reads the parsed cidrBlock of a node's config, tolerating invalid configs. */
function resolvedCidr(node: GraphNode): string | undefined {
	const config = resolvedConfigOf(node);
	return typeof config?.cidrBlock === "string" ? config.cidrBlock : undefined;
}

function stringList(config: Record<string, unknown>, key: string): string[] {
	const value = config[key];
	return Array.isArray(value)
		? value.filter((v): v is string => typeof v === "string")
		: [];
}

function stringValue(config: Record<string, unknown>, key: string): string {
	return typeof config[key] === "string" ? (config[key] as string) : "";
}

/**
 * Wiring validation (consumer → dependency edge direction):
 *  - subnet must point at exactly one VPC whose CIDR contains its own
 *  - an instance may live in at most one subnet
 *  - a security group must resolve to a VPC directly or via an attached instance
 *  - igw/nat/ebs/efs/alb/aurora/elasticache/iam/record/gateway wiring rules
 */
function validateNetworking(
	graph: InfrastructureGraph,
	firstNodeById: Map<string, GraphNode>,
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const typeOf = (id: string): string | undefined =>
		firstNodeById.get(id)?.type;
	const nodeRefs = resolveNodeRefs(graph);
	const consumerVpcs = new Map<string, string | undefined>();
	for (const node of firstNodeById.values()) {
		consumerVpcs.set(node.id, consumerVpc(node.id, nodeRefs));
	}
	const configOf = (id: string): Record<string, unknown> | undefined => {
		const node = firstNodeById.get(id);
		return node ? resolvedConfigOf(node) : undefined;
	};
	const hasEdge = (source: string, targetType: string): boolean =>
		graph.edges.some(
			(edge) => edge.source === source && typeOf(edge.target) === targetType,
		);

	for (const [nodeId, node] of firstNodeById) {
		if (node.type === "aws_subnet") {
			const parentVpcs = [
				...new Set(
					graph.edges
						.filter(
							(edge) =>
								edge.source === nodeId && typeOf(edge.target) === "aws_vpc",
						)
						.map((edge) => edge.target),
				),
			];
			if (parentVpcs.length === 0) {
				issues.push({
					code: "SUBNET_NO_VPC",
					message: `subnet "${nodeId}" must be connected to a VPC`,
					path: { kind: "node", id: nodeId },
				});
			} else if (parentVpcs.length > 1) {
				issues.push({
					code: "SUBNET_MULTIPLE_VPCS",
					message: `subnet "${nodeId}" is connected to multiple VPCs (${parentVpcs.join(", ")})`,
					path: { kind: "node", id: nodeId },
				});
			} else {
				const child = resolvedCidr(node);
				const parentNode = firstNodeById.get(parentVpcs[0] ?? "");
				const parent = parentNode ? resolvedCidr(parentNode) : undefined;
				if (child && parent && !cidrContains(parent, child)) {
					issues.push({
						code: "SUBNET_CIDR_OUTSIDE_VPC",
						message: `subnet "${nodeId}" CIDR ${child} is outside its VPC block ${parent}`,
						path: { kind: "node", id: nodeId },
					});
				}
			}
		}

		if (node.type === "aws_ec2") {
			const subnets = [
				...new Set(
					graph.edges
						.filter(
							(edge) =>
								edge.source === nodeId && typeOf(edge.target) === "aws_subnet",
						)
						.map((edge) => edge.target),
				),
			];
			if (subnets.length > 1) {
				issues.push({
					code: "EC2_MULTIPLE_SUBNETS",
					message: `instance "${nodeId}" is connected to multiple subnets (${subnets.join(", ")})`,
					path: { kind: "node", id: nodeId },
				});
			}
		}

		if (node.type === "aws_security_group") {
			if (!sgEffectiveVpc(nodeId, graph, nodeRefs)) {
				issues.push({
					code: "SG_NO_VPC",
					message: `security group "${nodeId}" must be connected to a VPC (directly or via an attached instance)`,
					path: { kind: "node", id: nodeId },
				});
			}
		}

		if (node.type === "aws_rds") {
			const subnetCount = nodeRefs.get(nodeId)?.subnets.length ?? 0;
			if (subnetCount < 2) {
				issues.push({
					code: "RDS_SUBNET_COUNT",
					message: `database "${nodeId}" needs subnets in at least two availability zones (connected to ${subnetCount})`,
					path: { kind: "node", id: nodeId },
				});
			}
		}

		if (node.type === "aws_internet_gateway") {
			if (!nodeRefs.get(nodeId)?.vpc) {
				issues.push({
					code: "IGW_NO_VPC",
					message: `internet gateway "${nodeId}" must be connected to a VPC`,
					path: { kind: "node", id: nodeId },
				});
			}
		}

		if (node.type === "aws_nat_gateway") {
			if (!nodeRefs.get(nodeId)?.subnet) {
				issues.push({
					code: "NAT_NO_SUBNET",
					message: `NAT gateway "${nodeId}" must be connected to a subnet`,
					path: { kind: "node", id: nodeId },
				});
			}
		}

		if (node.type === "aws_alb") {
			const refs = nodeRefs.get(nodeId);
			if ((refs?.subnets.length ?? 0) === 0) {
				issues.push({
					code: "ALB_NO_SUBNETS",
					message: `load balancer "${nodeId}" must be connected to at least one subnet`,
					path: { kind: "node", id: nodeId },
				});
			}
			if (!(consumerVpcs.get(nodeId) ?? refs?.vpc)) {
				issues.push({
					code: "ALB_NO_VPC",
					message: `load balancer "${nodeId}" must resolve a VPC (connect it to a subnet or VPC)`,
					path: { kind: "node", id: nodeId },
				});
			}
		}

		if (node.type === "aws_ebs") {
			if (!nodeRefs.get(nodeId)?.instanceRef) {
				issues.push({
					code: "EBS_NO_INSTANCE",
					message: `EBS volume "${nodeId}" must be connected to an EC2 instance`,
					path: { kind: "node", id: nodeId },
				});
			}
		}

		if (node.type === "aws_efs") {
			if ((nodeRefs.get(nodeId)?.subnets.length ?? 0) === 0) {
				issues.push({
					code: "EFS_NO_SUBNET",
					message: `EFS file system "${nodeId}" must be connected to at least one subnet`,
					path: { kind: "node", id: nodeId },
				});
			}
		}

		if (node.type === "aws_aurora") {
			const subnetCount = nodeRefs.get(nodeId)?.subnets.length ?? 0;
			if (subnetCount < 2) {
				issues.push({
					code: "AURORA_SUBNET_COUNT",
					message: `Aurora cluster "${nodeId}" needs subnets in at least two availability zones (connected to ${subnetCount})`,
					path: { kind: "node", id: nodeId },
				});
			}
		}

		if (node.type === "aws_lambda") {
			const refs = nodeRefs.get(nodeId);
			if (!refs?.iamRole) {
				issues.push({
					code: "LAMBDA_NO_ROLE",
					message: `lambda "${nodeId}" must be connected to an IAM role`,
					path: { kind: "node", id: nodeId },
				});
			}
			const config = configOf(nodeId);
			if (config?.codeSource === "zip") {
				if (!stringValue(config, "s3CodeBucket") || !stringValue(config, "s3CodeKey")) {
					issues.push({
						code: "LAMBDA_NO_ZIP_SOURCE",
						message: `lambda "${nodeId}" in zip mode needs an s3CodeBucket and s3CodeKey`,
						path: { kind: "node", id: nodeId },
					});
				}
			} else if ((refs?.repositories.length ?? 0) === 0) {
				issues.push({
					code: "LAMBDA_NO_REPOSITORY",
					message: `lambda "${nodeId}" in image mode must be connected to an ECR repository`,
					path: { kind: "node", id: nodeId },
				});
			}
		}

		if (node.type === "aws_ecs") {
			const refs = nodeRefs.get(nodeId);
			if ((refs?.subnets.length ?? 0) === 0) {
				issues.push({
					code: "ECS_NO_SUBNETS",
					message: `ECS service "${nodeId}" must be connected to at least one subnet`,
					path: { kind: "node", id: nodeId },
				});
			}
			if (!refs?.iamRole) {
				issues.push({
					code: "ECS_NO_ROLE",
					message: `ECS service "${nodeId}" must be connected to an IAM role`,
					path: { kind: "node", id: nodeId },
				});
			}
			const config = configOf(nodeId);
			if ((refs?.repositories.length ?? 0) === 0 && !stringValue(config ?? {}, "image")) {
				issues.push({
					code: "ECS_NO_IMAGE",
					message: `ECS service "${nodeId}" must be connected to an ECR repository or set an image`,
					path: { kind: "node", id: nodeId },
				});
			}
		}

		if (node.type === "aws_iam_policy") {
			if ((nodeRefs.get(nodeId)?.roles.length ?? 0) === 0) {
				issues.push({
					code: "POLICY_NO_ROLE",
					message: `IAM policy "${nodeId}" must be connected to an IAM role`,
					path: { kind: "node", id: nodeId },
				});
			}
		}

		if (node.type === "aws_route53_zone") {
			const config = configOf(nodeId);
			if (config?.privateZone === true && !nodeRefs.get(nodeId)?.vpc) {
				issues.push({
					code: "PRIVATE_ZONE_NO_VPC",
					message: `private hosted zone "${nodeId}" must be connected to a VPC`,
					path: { kind: "node", id: nodeId },
				});
			}
		}

		if (node.type === "aws_route53_record") {
			if (!nodeRefs.get(nodeId)?.zone) {
				issues.push({
					code: "RECORD_NO_ZONE",
					message: `DNS record "${nodeId}" must be connected to a Route 53 hosted zone`,
					path: { kind: "node", id: nodeId },
				});
			}
			const config = configOf(nodeId) ?? {};
			const hasAlias = hasEdge(nodeId, "aws_alb");
			const recordType = stringValue(config, "recordType") || "A";
			if (hasAlias && recordType !== "A" && recordType !== "AAAA") {
				issues.push({
					code: "RECORD_BAD_ALIAS_TYPE",
					message: `DNS record "${nodeId}" aliases a load balancer and must use type A or AAAA (got ${recordType})`,
					path: { kind: "node", id: nodeId },
				});
			}
			if (!hasAlias && stringList(config, "records").length === 0) {
				issues.push({
					code: "RECORD_NO_TARGET",
					message: `DNS record "${nodeId}" needs record values or a load balancer alias target`,
					path: { kind: "node", id: nodeId },
				});
			}
		}

		if (node.type === "aws_apigateway") {
			if ((nodeRefs.get(nodeId)?.targetFunctions.length ?? 0) === 0) {
				issues.push({
					code: "GATEWAY_NO_LAMBDA",
					message: `API Gateway "${nodeId}" must be connected to a Lambda function`,
					path: { kind: "node", id: nodeId },
				});
			}
		}
	}

	return issues;
}
