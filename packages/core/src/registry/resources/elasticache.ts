import { z } from "zod";

import { defineResource } from "../types";

export const ELASTICACHE_ENGINES = ["redis", "memcached"] as const;
export const ELASTICACHE_NODE_TYPES = [
	"cache.t3.micro",
	"cache.t3.small",
	"cache.t3.medium",
	"cache.m7g.large",
] as const;

export const elasticacheConfigSchema = z.strictObject({
	engine: z.enum(ELASTICACHE_ENGINES).default("redis"),
	nodeType: z.enum(ELASTICACHE_NODE_TYPES).default("cache.t3.micro"),
	numCacheNodes: z.number().int().min(1).max(20).default(1),
	port: z.number().int().min(1).max(65535).optional(),
	parameterGroupName: z.string().min(1).optional(),
});

export type ElasticacheConfig = z.infer<typeof elasticacheConfigSchema>;

export const elasticacheResource = defineResource(
	{
		type: "aws_elasticache",
		tofuKind: "aws_elasticache_cluster",
		label: "ElastiCache",
		description: "In-memory cache (Redis/Memcached)",
		category: "database",
	},
	elasticacheConfigSchema,
);