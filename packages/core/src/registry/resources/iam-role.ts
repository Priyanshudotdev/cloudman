import { z } from "zod";

import { defineResource } from "../types";

export const IAM_ASSUME_SERVICES = [
	"ec2",
	"lambda",
	"ecs-tasks",
	"apigateway",
	"eks",
	"events",
	"ssm",
] as const;

export const iamRoleConfigSchema = z.strictObject({
	assumeService: z.enum(IAM_ASSUME_SERVICES).default("ec2"),
	name: z.string().min(1).optional(),
});

export type IamRoleConfig = z.infer<typeof iamRoleConfigSchema>;

export const iamRoleResource = defineResource(
	{
		type: "aws_iam_role",
		tofuKind: "aws_iam_role",
		label: "IAM Role",
		description: "Identity with an assume-role trust policy",
		category: "iam",
	},
	iamRoleConfigSchema,
);
