import { z } from "zod";

import { defineResource } from "../types";

export const EC2_INSTANCE_TYPES = [
	"t2.micro",
	"t3.micro",
	"t3.small",
	"t3.medium",
] as const;

export const ec2ConfigSchema = z.strictObject({
	instanceType: z.enum(EC2_INSTANCE_TYPES).default("t3.micro"),
	ami: z.string().min(1).optional(),
	keyPairName: z.string().min(1).optional(),
	volumeSizeGb: z.number().int().min(8).max(1024).default(8),
});

export type Ec2Config = z.infer<typeof ec2ConfigSchema>;

export const ec2Resource = defineResource(
	{
		type: "aws_ec2",
		tofuKind: "aws_instance",
		label: "EC2 Instance",
		description: "AWS Elastic Compute Cloud virtual machine",
		category: "compute",
	},
	ec2ConfigSchema,
);
