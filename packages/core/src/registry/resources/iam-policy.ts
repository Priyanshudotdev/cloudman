import { z } from "zod";

import { defineResource } from "../types";

export const iamPolicyConfigSchema = z.strictObject({
	name: z.string().min(1).optional(),
	actions: z
		.array(z.string().min(1))
		.max(25)
		.default(["s3:GetObject"]),
	resources: z.array(z.string().min(1)).max(25).default(["*"]),
});

export type IamPolicyConfig = z.infer<typeof iamPolicyConfigSchema>;

export const iamPolicyResource = defineResource(
	{
		type: "aws_iam_policy",
		tofuKind: "aws_iam_policy",
		label: "IAM Policy",
		description: "Permissions document attachable to a role",
		category: "iam",
	},
	iamPolicyConfigSchema,
);