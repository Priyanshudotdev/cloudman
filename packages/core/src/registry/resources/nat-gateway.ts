import { z } from "zod";

import { defineResource } from "../types";

export const NAT_CONNECTIVITY_TYPES = ["public", "private"] as const;

export const natGatewayConfigSchema = z.strictObject({
	connectivityType: z.enum(NAT_CONNECTIVITY_TYPES).default("public"),
});

export type NatGatewayConfig = z.infer<typeof natGatewayConfigSchema>;

export const natGatewayResource = defineResource(
	{
		type: "aws_nat_gateway",
		tofuKind: "aws_nat_gateway",
		label: "NAT Gateway",
		description: "Outbound connectivity for private subnets",
		category: "network",
	},
	natGatewayConfigSchema,
);
