import { z } from "zod";

import { defineResource } from "../types";

export const AURORA_ENGINES = ["aurora-postgresql", "aurora-mysql"] as const;
export const AURORA_INSTANCE_CLASSES = [
	"db.t3.medium",
	"db.t4g.medium",
	"db.r5.large",
	"db.r6g.large",
] as const;

export const auroraConfigSchema = z.strictObject({
	engine: z.enum(AURORA_ENGINES).default("aurora-postgresql"),
	engineVersion: z.string().min(1).optional(),
	instanceClass: z.enum(AURORA_INSTANCE_CLASSES).default("db.t4g.medium"),
	dbName: z
		.string()
		.regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "must start with a letter")
		.default("appdb"),
	dbUsername: z
		.string()
		.regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "must start with a letter")
		.default("cloudman_admin"),
});

export type AuroraConfig = z.infer<typeof auroraConfigSchema>;

export const auroraResource = defineResource(
	{
		type: "aws_aurora",
		tofuKind: "aws_rds_cluster",
		label: "Aurora Database",
		description: "Managed multi-AZ relational cluster",
		category: "database",
	},
	auroraConfigSchema,
);