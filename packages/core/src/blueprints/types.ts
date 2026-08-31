import type { InfrastructureGraph } from "../graph/schema";

export interface Blueprint {
	id: string;
	name: string;
	description: string;
	/** Short tags surfaced in the UI when a match is made. */
	tags: string[];
}

export interface GenerateResult {
	/** Matched blueprint id (or the default). */
	blueprint: string;
	mode: "engine" | "llm";
	graph: InfrastructureGraph;
	warnings: string[];
}

export interface BlueprintGraph {
	metadata: Blueprint;
	/** Fresh copy is handed out per call so callers can mutate freely. */
	build(): InfrastructureGraph;
}
