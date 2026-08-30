import { z } from "zod";

import { defineResource } from "../types";

export const sqsConfigSchema = z.strictObject({
	visibilityTimeoutSec: z.number().int().min(1).max(43200).default(30),
	delaySeconds: z.number().int().min(0).max(900).default(0),
	fifo: z.boolean().default(false),
});

export type SqsConfig = z.infer<typeof sqsConfigSchema>;

export const sqsResource = defineResource(
	{
		type: "aws_sqs",
		tofuKind: "aws_sqs_queue",
		label: "SQS Queue",
		description: "Reliable message queue",
		category: "messaging",
	},
	sqsConfigSchema,
);