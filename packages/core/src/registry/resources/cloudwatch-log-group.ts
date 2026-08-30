import { z } from "zod";

import { defineResource } from "../types";

export const LOG_RETENTION_DAYS = [
	1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1827, 3653,
] as const;

export const retentionDaysSchema = z.union(
	LOG_RETENTION_DAYS.map((days) => z.literal(days)),
);

export const cloudwatchLogGroupConfigSchema = z.strictObject({
	retentionDays: retentionDaysSchema.default(14),
});

export type CloudwatchLogGroupConfig = z.infer<
	typeof cloudwatchLogGroupConfigSchema
>;

export const cloudwatchLogGroupResource = defineResource(
	{
		type: "aws_cloudwatch_log_group",
		tofuKind: "aws_cloudwatch_log_group",
		label: "Log Group",
		description: "CloudWatch log retention group",
		category: "observability",
	},
	cloudwatchLogGroupConfigSchema,
);
