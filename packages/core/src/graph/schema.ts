import { z } from "zod";

export const NODE_ID_PATTERN = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

export const graphNodeSchema = z.object({
	id: z
		.string()
		.regex(
			NODE_ID_PATTERN,
			"node id must be lowercase alphanumeric with dashes",
		),
	type: z.string().min(1),
	label: z.string().min(1).max(80).optional(),
	config: z.record(z.string(), z.unknown()).default({}),
});

export const graphEdgeSchema = z.object({
	id: z.string().optional(),
	source: z.string().min(1),
	target: z.string().min(1),
});

export const infrastructureGraphSchema = z.object({
	version: z.literal(1).default(1),
	name: z.string().min(1).max(80).default("Untitled infrastructure"),
	nodes: z.array(graphNodeSchema).default([]),
	edges: z.array(graphEdgeSchema).default([]),
});

export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type InfrastructureGraph = z.infer<typeof infrastructureGraphSchema>;
