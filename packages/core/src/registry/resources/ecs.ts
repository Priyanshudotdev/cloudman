import { z } from "zod";

import { defineResource } from "../types";

export const ECS_CPU_SIZES = [
	"0.25 vCPU",
	"0.5 vCPU",
	"1 vCPU",
	"2 vCPU",
	"4 vCPU",
] as const;
export const ECS_MEMORY_SIZES = [
	"0.5 GB",
	"1 GB",
	"2 GB",
	"4 GB",
	"8 GB",
	"16 GB",
] as const;

export const ecsConfigSchema = z.strictObject({
	cpu: z.enum(ECS_CPU_SIZES).default("0.25 vCPU"),
	memory: z.enum(ECS_MEMORY_SIZES).default("0.5 GB"),
	containerPort: z.number().int().min(1).max(65535).default(80),
	desiredCount: z.number().int().min(1).max(100).default(1),
	imageTag: z.string().min(1).default("latest"),
	/** Literal image override; when absent the wired ECR repository is used. */
	image: z.string().min(1).optional(),
	assignPublicIp: z.boolean().default(false),
});

export type EcsConfig = z.infer<typeof ecsConfigSchema>;

export const ecsResource = defineResource(
	{
		type: "aws_ecs",
		tofuKind: "aws_ecs_cluster",
		label: "ECS Service",
		description: "Fargate container orchestration",
		category: "compute",
	},
	ecsConfigSchema,
);