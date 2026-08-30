import { z } from "zod";

import { defineResource } from "../types";

export const ROUTE53_RECORD_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX"] as const;

export const route53RecordConfigSchema = z.strictObject({
	recordName: z.string().min(1).max(255),
	recordType: z.enum(ROUTE53_RECORD_TYPES).default("A"),
	ttl: z.number().int().min(1).max(86400).default(300),
	/** Static record values; ignored when the record aliases a wired ALB. */
	records: z.array(z.string().min(1)).max(4).default([]),
});

export type Route53RecordConfig = z.infer<typeof route53RecordConfigSchema>;

export const route53RecordResource = defineResource(
	{
		type: "aws_route53_record",
		tofuKind: "aws_route53_record",
		label: "Route 53 Record",
		description: "DNS record inside a hosted zone",
		category: "dns",
	},
	route53RecordConfigSchema,
);