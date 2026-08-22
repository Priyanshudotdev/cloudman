import type { InfrastructureGraph } from "./schema";

/**
 * Edge semantics: an edge { source, target } means "source depends on target".
 * Therefore `target` must appear before `source` in the resolved order.
 */
export type DependencyResolution =
	| { ok: true; order: string[] }
	| { ok: false; cycle: string[] };

export function resolveDependencies(
	graph: InfrastructureGraph,
): DependencyResolution {
	const dependencies = new Map<string, Set<string>>();
	const dependents = new Map<string, Set<string>>();

	for (const node of graph.nodes) {
		dependencies.set(node.id, new Set());
		dependents.set(node.id, new Set());
	}

	for (const edge of graph.edges) {
		if (!dependencies.has(edge.source) || !dependencies.has(edge.target))
			continue;
		dependencies.get(edge.source)?.add(edge.target);
		dependents.get(edge.target)?.add(edge.source);
	}

	const ready: string[] = [];
	for (const [nodeId, deps] of dependencies) {
		if (deps.size === 0) ready.push(nodeId);
	}

	const order: string[] = [];
	while (ready.length > 0) {
		const nodeId = ready.shift();
		if (nodeId === undefined) break;
		order.push(nodeId);
		for (const dependentId of dependents.get(nodeId) ?? []) {
			const deps = dependencies.get(dependentId);
			if (!deps) continue;
			deps.delete(nodeId);
			if (deps.size === 0) ready.push(dependentId);
		}
	}

	if (order.length !== graph.nodes.length) {
		const orderedSet = new Set(order);
		const cycle = graph.nodes
			.map((n) => n.id)
			.filter((id) => !orderedSet.has(id));
		return { ok: false, cycle };
	}

	return { ok: true, order };
}
