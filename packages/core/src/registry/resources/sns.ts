import { z } from "zod";

import { defineResource } from "../types";

export const snsConfigSchema = z.strictObject({
	displayName: z.string().min(1).max(100).optional(),
});

export type SnsConfig = z.infer<typeof snsConfigSchema>;

export const snsResource = defineResource(
	{
		type: "aws_sns",
		tofuKind: "aws_sns_topic",
		label: "SNS Topic",
		description: "Pub/sub notification topic",
		category: "messaging",
	},
	snsConfigSchema,
);