import { z } from "zod";

import { isValidIpv4Cidr } from "../../graph/cidr";
import { defineResource } from "../types";

export const subnetConfigSchema = z.strictObject({
	cidrBlock: z
		.string()
		.refine(isValidIpv4Cidr, "must be an IPv4 CIDR block (e.g. 10.0.1.0/24)"),
	availabilityZone: z.string().min(1).optional(),
});

export type SubnetConfig = z.infer<typeof subnetConfigSchema>;

export const subnetResource = defineResource(
	{
		type: "aws_subnet",
		tofuKind: "aws_subnet",
		label: "Subnet",
		description: "Subnet inside a VPC",
		category: "network",
	},
	subnetConfigSchema,
);
