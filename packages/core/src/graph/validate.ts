import { ZodError } from "zod";

import { getResourceDefinition } from "../registry";
import { resolveDependencies } from "./dependencies";
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

	return { valid: issues.length === 0, issues };
}
