import { z } from "zod";

import { defineResource } from "../types";

export const route53ZoneConfigSchema = z.strictObject({
	zoneName: z
		.string()
		.min(1)
		.regex(
			/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
			"must be a registered domain (e.g. example.com)",
		),
	privateZone: z.boolean().default(false),
});

export type Route53ZoneConfig = z.infer<typeof route53ZoneConfigSchema>;

export const route53ZoneResource = defineResource(
	{
		type: "aws_route53_zone",
		tofuKind: "aws_route53_zone",
		label: "Route 53 Zone",
		description: "DNS hosted zone",
		category: "dns",
	},
	route53ZoneConfigSchema,
);
