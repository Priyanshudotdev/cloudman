import { z } from "zod";

import { defineResource } from "../types";

export const ALB_SCHEMES = ["internet-facing", "internal"] as const;
export const ALB_PROTOCOLS = ["HTTP", "HTTPS"] as const;

export const albConfigSchema = z.strictObject({
	scheme: z.enum(ALB_SCHEMES).default("internet-facing"),
	listenerPort: z.number().int().min(1).max(65535).default(80),
	listenerProtocol: z.enum(ALB_PROTOCOLS).default("HTTP"),
	healthCheckPath: z.string().min(1).default("/"),
});

export type AlbConfig = z.infer<typeof albConfigSchema>;

export const albResource = defineResource(
	{
		type: "aws_alb",
		tofuKind: "aws_lb",
		label: "Application Load Balancer",
		description: "Layer 7 traffic distribution to EC2 targets",
		category: "network",
	},
	albConfigSchema,
);
