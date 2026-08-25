import { z } from "zod";

import { defineResource } from "../types";

export const RDS_ENGINES = ["postgres", "mysql"] as const;
export const RDS_INSTANCE_CLASSES = [
	"db.t3.micro",
	"db.t3.small",
	"db.t3.medium",
] as const;

export const rdsConfigSchema = z.strictObject({
	engine: z.enum(RDS_ENGINES).default("postgres"),
	engineVersion: z.string().min(1).optional(),
	instanceClass: z.enum(RDS_INSTANCE_CLASSES).default("db.t3.micro"),
	allocatedStorageGb: z.number().int().min(20).max(65536).default(20),
	dbName: z
		.string()
		.regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "must start with a letter")
		.default("appdb"),
	username: z
		.string()
		.regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "must start with a letter")
		.default("cloudman_admin"),
	publiclyAccessible: z.boolean().default(false),
	skipFinalSnapshot: z.boolean().default(true),
});

export type RdsConfig = z.infer<typeof rdsConfigSchema>;

export const rdsResource = defineResource(
	{
		type: "aws_rds",
		tofuKind: "aws_db_instance",
		label: "RDS Database",
		description: "Managed relational database (Postgres/MySQL)",
		category: "database",
	},
	rdsConfigSchema,
);
