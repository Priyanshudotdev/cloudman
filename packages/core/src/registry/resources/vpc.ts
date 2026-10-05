import { z } from "zod";

import { isValidIpv4Cidr } from "../../graph/cidr";
import { defineResource } from "../types";

export const vpcConfigSchema = z.strictObject({
	cidrBlock: z
		.string()
		.refine(isValidIpv4Cidr, "must be an IPv4 CIDR block (e.g. 10.0.0.0/16)")
		.default("10.0.0.0/16"),
	enableDnsHostnames: z.boolean().default(true),
});

export type VpcConfig = z.infer<typeof vpcConfigSchema>;

export const vpcResource = defineResource(
	{
		type: "aws_vpc",
		tofuKind: "aws_vpc",
		label: "VPC",
		description: "Isolated virtual network",
		category: "network",
	},
	vpcConfigSchema,
);
