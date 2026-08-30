import { z } from "zod";

import { defineResource } from "../types";

export const ECR_TAG_MUTABILITIES = ["MUTABLE", "IMMUTABLE"] as const;

export const ecrConfigSchema = z.strictObject({
	scanOnPush: z.boolean().default(true),
	tagMutability: z.enum(ECR_TAG_MUTABILITIES).default("MUTABLE"),
});

export type EcrConfig = z.infer<typeof ecrConfigSchema>;

export const ecrResource = defineResource(
	{
		type: "aws_ecr",
		tofuKind: "aws_ecr_repository",
		label: "ECR Repository",
		description: "Docker container image registry",
		category: "compute",
	},
	ecrConfigSchema,
);