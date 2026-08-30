import { z } from "zod";

import { defineResource } from "../types";

export const internetGatewayConfigSchema = z.strictObject({});

export type InternetGatewayConfig = z.infer<typeof internetGatewayConfigSchema>;

export const internetGatewayResource = defineResource(
	{
		type: "aws_internet_gateway",
		tofuKind: "aws_internet_gateway",
		label: "Internet Gateway",
		description: "Outbound internet access for a VPC",
		category: "network",
	},
	internetGatewayConfigSchema,
);