import { z } from "zod";

export const irResourceSchema = z.object({
	/** Stable id, mirrors the originating graph node id. */
	irId: z.string().min(1),
	/** OpenTofu resource type, e.g. "aws_instance". */
	kind: z.string().min(1),
	/** Sanitized OpenTofu resource name, unique across the document. */
	name: z.string().min(1),
	/** Human label from the canvas node. */
	label: z.string().optional(),
	/** Resolved attributes (snake_case), ready for template rendering. */
	attributes: z.record(z.string(), z.unknown()),
	/** irIds this resource must be created after. */
	dependsOn: z.array(z.string()).default([]),
});

export const irDocumentSchema = z.object({
	version: z.literal(1),
	/** Infrastructure / project display name. */
	name: z.string().min(1),
	/** AWS region the provider will target. */
	region: z.string().min(1),
	resources: z.array(irResourceSchema).min(0),
});

export type IRResource = z.infer<typeof irResourceSchema>;
export type IRDocument = z.infer<typeof irDocumentSchema>;
