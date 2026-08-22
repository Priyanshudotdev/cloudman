import { z } from "zod";

import { defineResource } from "../types";

export const S3_BUCKET_NAME_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

export const s3ConfigSchema = z.strictObject({
	bucketName: z.string().regex(S3_BUCKET_NAME_PATTERN).optional(),
	versioning: z.boolean().default(false),
	forceDestroy: z.boolean().default(true),
});

export type S3Config = z.infer<typeof s3ConfigSchema>;

export const s3Resource = defineResource(
	{
		type: "aws_s3",
		tofuKind: "aws_s3_bucket",
		label: "S3 Bucket",
		description: "AWS Simple Storage Service bucket",
		category: "storage",
	},
	s3ConfigSchema,
);
