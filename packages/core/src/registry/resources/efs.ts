import { z } from "zod";

import { defineResource } from "../types";

export const EFS_PERFORMANCE_MODES = ["generalPurpose", "maxIO"] as const;
export const EFS_THROUGHPUT_MODES = ["bursting", "elastic"] as const;

export const efsConfigSchema = z.strictObject({
	performanceMode: z.enum(EFS_PERFORMANCE_MODES).default("generalPurpose"),
	throughputMode: z.enum(EFS_THROUGHPUT_MODES).default("elastic"),
	encrypted: z.boolean().default(true),
});

export type EfsConfig = z.infer<typeof efsConfigSchema>;

export const efsResource = defineResource(
	{
		type: "aws_efs",
		tofuKind: "aws_efs_file_system",
		label: "EFS File System",
		description: "Shared network file storage",
		category: "storage",
	},
	efsConfigSchema,
);
