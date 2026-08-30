import { z } from "zod";

import { defineResource } from "../types";

export const LAMBDA_RUNTIMES = [
	"nodejs22.x",
	"nodejs20.x",
	"python3.13",
	"python3.12",
] as const;
export const LAMBDA_CODE_SOURCES = ["image", "zip"] as const;

export const lambdaConfigSchema = z.strictObject({
	codeSource: z.enum(LAMBDA_CODE_SOURCES).default("image"),
	runtime: z.enum(LAMBDA_RUNTIMES).default("nodejs22.x"),
	handler: z.string().min(1).default("index.handler"),
	memoryMb: z.number().int().min(128).max(10240).default(128),
	timeoutSec: z.number().int().min(1).max(900).default(3),
	/** Required when codeSource = "zip": bucket + key hosting the deployment package. */
	s3CodeBucket: z.string().min(1).optional(),
	s3CodeKey: z.string().min(1).optional(),
});

export type LambdaConfig = z.infer<typeof lambdaConfigSchema>;

export const lambdaResource = defineResource(
	{
		type: "aws_lambda",
		tofuKind: "aws_lambda_function",
		label: "Lambda Function",
		description: "Serverless function runner",
		category: "serverless",
	},
	lambdaConfigSchema,
);