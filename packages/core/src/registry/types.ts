import type { z } from "zod";

export type ResourceCategory = "compute" | "storage" | "network" | "database";

export interface BaseResourceDefinition {
	readonly type: string;
	readonly tofuKind: string;
	readonly label: string;
	readonly description: string;
	readonly category: ResourceCategory;
}

export interface RegisteredResource extends BaseResourceDefinition {
	/** Validates raw node config against the resource schema and applies defaults. Throws on invalid input. */
	resolveConfig(raw: unknown): Record<string, unknown>;
}

/**
 * Wires a strongly-typed zod config schema into the registry behind an
 * erased interface so heterogeneous resources can live in one map.
 */
export function defineResource<C>(
	definition: BaseResourceDefinition,
	configSchema: z.ZodType<C>,
): RegisteredResource {
	return {
		...definition,
		resolveConfig(raw: unknown): Record<string, unknown> {
			return configSchema.parse(raw) as Record<string, unknown>;
		},
	};
}
