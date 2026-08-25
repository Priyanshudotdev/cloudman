import { ZodError } from "zod";

import { getResourceDefinition } from "../registry";
import { cidrContains } from "./cidr";
import { resolveDependencies } from "./dependencies";
import { resolveNodeRefs, sgEffectiveVpc } from "./refs";
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

/** Reads the parsed cidrBlock of a node's config, tolerating invalid configs. */
function resolvedCidr(node: GraphNode): string | undefined {
	const definition = getResourceDefinition(node.type);
	if (!definition) return undefined;
	try {
		const config = definition.resolveConfig(node.config) as Record<
			string,
			unknown
		>;
		return typeof config.cidrBlock === "string" ? config.cidrBlock : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Networking wiring rules (consumer → dependency edge direction):
 *  - subnet must point at exactly one VPC whose CIDR contains its own
 *  - an instance may live in at most one subnet
 *  - a security group must resolve to a VPC directly or via an attached instance
 */
function validateNetworking(
	graph: InfrastructureGraph,
	firstNodeById: Map<string, GraphNode>,
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const typeOf = (id: string): string | undefined =>
		firstNodeById.get(id)?.type;
	const nodeRefs = resolveNodeRefs(graph);

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
	}

	return issues;
}
