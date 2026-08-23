import { z } from "zod";

import { isValidIpv4Cidr } from "../../graph/cidr";
import { defineResource } from "../types";

export const SG_PROTOCOLS = ["tcp", "udp", "icmp"] as const;

export const ingressRuleSchema = z.strictObject({
	fromPort: z.number().int().min(0).max(65535),
	toPort: z.number().int().min(0).max(65535),
	protocol: z.enum(SG_PROTOCOLS).default("tcp"),
	cidrBlock: z
		.string()
		.refine(isValidIpv4Cidr, "must be an IPv4 CIDR block (e.g. 0.0.0.0/0)")
		.default("0.0.0.0/0"),
});

export type IngressRule = z.infer<typeof ingressRuleSchema>;

export const securityGroupConfigSchema = z.strictObject({
	description: z.string().min(1).max(255).default("Managed by CloudMan"),
	ingressRules: z.array(ingressRuleSchema).default([]),
});

export type SecurityGroupConfig = z.infer<typeof securityGroupConfigSchema>;

export const securityGroupResource = defineResource(
	{
		type: "aws_security_group",
		tofuKind: "aws_security_group",
		label: "Security Group",
		description: "Instance-level firewall rules",
		category: "network",
	},
	securityGroupConfigSchema,
);
