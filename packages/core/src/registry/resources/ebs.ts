import { z } from "zod";

import { defineResource } from "../types";

export const EBS_VOLUME_TYPES = ["gp3", "gp2", "io1", "st1", "sc1"] as const;

export const ebsConfigSchema = z.strictObject({
	sizeGb: z.number().int().min(1).max(16384).default(10),
	type: z.enum(EBS_VOLUME_TYPES).default("gp3"),
	iops: z.number().int().min(100).max(64000).optional(),
	device: z.string().min(1).default("/dev/sdf"),
	encrypted: z.boolean().default(true),
});

export type EbsConfig = z.infer<typeof ebsConfigSchema>;

export const ebsResource = defineResource(
	{
		type: "aws_ebs",
		tofuKind: "aws_ebs_volume",
		label: "EBS Volume",
		description: "Block storage attachable to an EC2 instance",
		category: "storage",
	},
	ebsConfigSchema,
);