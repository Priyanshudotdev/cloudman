"use client";

import {
	Background,
	type Connection,
	Controls,
	type Edge,
	MarkerType,
	MiniMap,
	type Node,
	ReactFlow,
	ReactFlowProvider,
	useEdgesState,
	useNodesState,
	useReactFlow,
} from "@xyflow/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import "@xyflow/react/dist/style.css";

import { Badge } from "@my-better-t-app/ui/components/badge";
import { Button } from "@my-better-t-app/ui/components/button";
import { toast } from "sonner";

import type {
	CompileResultDto,
	ProjectDto,
	ValidationIssueDto,
} from "@/lib/api";
import { ApiError, api } from "@/lib/api";
import type { GraphJson } from "@/lib/graph-types";
import {
	defaultConfig,
	RESOURCE_SPECS,
	type ResourceUiSpec,
} from "@/lib/resource-catalog";
import { CompilePreview } from "./compile-preview";
import { ConfigPanel } from "./config-panel";
import { DeployPanel } from "./deploy-panel";
import { GraphVersions } from "./graph-versions";
import { type ResourceFlowNode, ResourceNode } from "./resource-node";

const nodeTypes = { resource: ResourceNode };

function makeNodeId(prefix: string, existing: Set<string>): string {
	let counter = 1;
	let candidate = `${prefix}-${counter}`;
	while (existing.has(candidate)) {
		counter += 1;
		candidate = `${prefix}-${counter}`;
	}
	return candidate;
}

function flowFromGraph(graph: GraphJson): {
	nodes: ResourceFlowNode[];
	edges: Edge[];
} {
	const nodes: ResourceFlowNode[] = graph.nodes.map((node, index) => ({
		id: node.id,
		type: "resource",
		position: {
			x: 80 + (index % 4) * 260,
			y: 60 + Math.floor(index / 4) * 180,
		},
		data: {
			resourceType: node.type,
			label: node.label ?? node.id,
			config: node.config ?? {},
		},
	}));
	const edges: Edge[] = graph.edges.map((edge) => ({
		id: edge.id ?? `${edge.source}->${edge.target}`,
		source: edge.source,
		target: edge.target,
		markerEnd: { type: MarkerType.ArrowClosed },
	}));
	return { nodes, edges };
}

function graphFromFlow(nodes: Node[], edges: Edge[], name: string): GraphJson {
	return {
		version: 1,
		name,
		nodes: nodes.map((node) => {
			const data = node.data as ResourceFlowNode["data"];
			return {
				id: node.id,
				type: data.resourceType,
				label: data.label,
				config: data.config ?? {},
			};
		}),
		edges: edges.map((edge) => ({ source: edge.source, target: edge.target })),
	};
}

export function CanvasEditor({ projectId }: { projectId: string }) {
	return (
		<ReactFlowProvider>
			<CanvasEditorInner projectId={projectId} />
		</ReactFlowProvider>
	);
}

function CanvasEditorInner({ projectId }: { projectId: string }) {
	const reactFlow = useReactFlow();
	const [nodes, setNodes, onNodesChange] = useNodesState<ResourceFlowNode>([]);
	const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [projectName, setProjectName] = useState("");
	const [version, setVersion] = useState(0);
	const [loading, setLoading] = useState(true);
	const [issues, setIssues] = useState<ValidationIssueDto[]>([]);
	const [busy, setBusy] = useState(false);
	const [deployOpen, setDeployOpen] = useState(false);
	const [deployAction, setDeployAction] = useState<"provision" | "destroy">(
		"provision",
	);
	const [preview, setPreview] = useState<CompileResultDto | null>(null);
	const [versionsOpen, setVersionsOpen] = useState(false);

	useEffect(() => {
		async function load() {
			try {
				const [{ project }, { graphVersion }] = await Promise.all([
					api<{ project: ProjectDto }>(`/api/projects/${projectId}`),
					api<{ graphVersion: { version: number; graph: GraphJson } | null }>(
						`/api/projects/${projectId}/graph/latest`,
					),
				]);
				setProjectName(project.name);
				setVersion(project.latestGraphVersion);
				if (graphVersion?.graph?.nodes) {
					const flow = flowFromGraph({
						...graphVersion.graph,
						version: 1,
						name: project.name,
						nodes: graphVersion.graph.nodes ?? [],
						edges: graphVersion.graph.edges ?? [],
					});
					setNodes(flow.nodes);
					setEdges(flow.edges);
				}
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : "Failed to load project",
				);
			} finally {
				setLoading(false);
			}
		}
		void load();
	}, [projectId, setNodes, setEdges]);

	const selectedNode = useMemo(
		() => nodes.find((node) => node.id === selectedId) ?? null,
		[nodes, selectedId],
	);

	const onConnect = useCallback(
		(connection: Connection) => {
			if (connection.source === connection.target) return;
			setEdges((current) => {
				const duplicate = current.some(
					(edge) =>
						edge.source === connection.source &&
						edge.target === connection.target,
				);
				if (duplicate || !connection.source || !connection.target)
					return current;
				return [
					...current,
					{
						id: `${connection.source}->${connection.target}`,
						source: connection.source,
						target: connection.target,
						markerEnd: { type: MarkerType.ArrowClosed },
					},
				];
			});
			setIssues([]);
		},
		[setEdges],
	);

	const onDrop = useCallback(
		(event: React.DragEvent) => {
			event.preventDefault();
			const resourceType = event.dataTransfer.getData(
				"application/cloudman-resource",
			);
			const spec = RESOURCE_SPECS[resourceType];
			if (!spec) return;

			const position = reactFlow.screenToFlowPosition({
				x: event.clientX,
				y: event.clientY,
			});

			setNodes((current) => {
				const id = makeNodeId(spec.idPrefix, new Set(current.map((n) => n.id)));
				setSelectedId(id);
				return [
					...current,
					{
						id,
						type: "resource",
						position,
						data: {
							resourceType,
							label: spec.label,
							config: defaultConfig(spec),
						},
					},
				];
			});
			setIssues([]);
		},
		[reactFlow, setNodes],
	);

	function updateSelectedData(update: Partial<ResourceFlowNode["data"]>) {
		if (!selectedId) return;
		setNodes((current) =>
			current.map((node) =>
				node.id === selectedId
					? { ...node, data: { ...node.data, ...update } }
					: node,
			),
		);
	}

	function currentGraph(): GraphJson {
		return graphFromFlow(
			nodes,
			edges,
			projectName || "Untitled infrastructure",
		);
	}

	async function handleSave(): Promise<boolean> {
		setBusy(true);
		setIssues([]);
		try {
			const result = await api<{ version: number }>(
				`/api/projects/${projectId}/graph`,
				{
					method: "PUT",
					body: JSON.stringify({ graph: currentGraph() }),
				},
			);
			setVersion(result.version);
			toast.success(`Graph saved as version ${result.version}`);
			return true;
		} catch (error) {
			if (error instanceof ApiError && error.issues) {
				setIssues(error.issues);
				toast.error("Graph has validation errors");
			} else {
				toast.error(
					error instanceof Error ? error.message : "Failed to save graph",
				);
			}
			return false;
		} finally {
			setBusy(false);
		}
	}

	async function handleValidate() {
		setBusy(true);
		setIssues([]);
		try {
			const result = await api<CompileResultDto>("/api/compile", {
				method: "POST",
				body: JSON.stringify({ graph: currentGraph() }),
			});
			setPreview(result);
			toast.success(
				`Compiles clean — ${result.stats.resources} resources, ${result.stats.files} tofu files`,
			);
		} catch (error) {
			if (error instanceof ApiError && error.issues) {
				setIssues(error.issues);
			} else {
				toast.error(
					error instanceof Error ? error.message : "Validation failed",
				);
			}
		} finally {
			setBusy(false);
		}
	}

	async function handleDeploy(action: "provision" | "destroy") {
		// Destruction pins to the last completed provision's graph server-side,
		// so saving the canvas first is only needed for provision runs.
		if (action === "provision") {
			const saved = await handleSave();
			if (!saved) return;
		}
		setDeployAction(action);
		setDeployOpen(true);
	}

	function handleVersionLoad(graph: GraphJson, loadedVersion: number) {
		const flow = flowFromGraph({
			...graph,
			version: 1,
			name: projectName || "Untitled infrastructure",
			nodes: graph.nodes ?? [],
			edges: graph.edges ?? [],
		});
		setNodes(flow.nodes);
		setEdges(flow.edges);
		setSelectedId(null);
		setIssues([]);
		setPreview(null);
		toast.success(`Loaded version ${loadedVersion} (unsaved)`);
	}

	const selectedSpec: ResourceUiSpec | null = selectedNode
		? (RESOURCE_SPECS[selectedNode.data.resourceType] ?? null)
		: null;

	if (loading) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground text-sm">
				Loading canvas...
			</div>
		);
	}

	return (
		<div className="relative flex h-full min-h-0 flex-col">
			<div className="flex items-center gap-3 border-b bg-card px-4 py-2">
				<Link
					href="/dashboard"
					className="text-muted-foreground text-sm hover:text-foreground"
				>
					← Projects
				</Link>
				<span className="font-semibold text-sm">{projectName}</span>
				{version > 0 && <Badge variant="secondary">v{version}</Badge>}
				<div className="ml-auto flex items-center gap-2">
					<Button
						variant="ghost"
						size="sm"
						disabled={busy}
						onClick={() => setVersionsOpen(true)}
					>
						Versions
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => void handleValidate()}
					>
						Validate
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => void handleSave()}
					>
						Save
					</Button>
					<Button
						variant="destructive"
						size="sm"
						disabled={busy}
						onClick={() => void handleDeploy("destroy")}
					>
						Destroy
					</Button>
					<Button
						size="sm"
						disabled={busy}
						onClick={() => void handleDeploy("provision")}
					>
						Deploy
					</Button>
				</div>
			</div>

			{issues.length > 0 && (
				<div className="border-red-200 border-b bg-red-50 px-4 py-2 dark:border-red-900 dark:bg-red-950">
					<p className="mb-1 font-semibold text-red-700 text-xs dark:text-red-400">
						{issues.length} validation issue(s)
					</p>
					<ul className="space-y-0.5 font-mono text-[11px] text-red-600 dark:text-red-300">
						{issues.map((issue, index) => (
							<li key={`${issue.code}-${index}`}>{issue.message}</li>
						))}
					</ul>
				</div>
			)}

			<div className="flex min-h-0 flex-1">
				<div className="w-48 shrink-0 space-y-2 overflow-y-auto border-r bg-card p-3">
					<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
						Resources
					</p>
					{Object.values(RESOURCE_SPECS).map((spec) => (
						<button
							type="button"
							key={spec.type}
							draggable
							onDragStart={(event) => {
								event.dataTransfer.setData(
									"application/cloudman-resource",
									spec.type,
								);
								event.dataTransfer.effectAllowed = "move";
							}}
							className="flex cursor-grab items-center gap-2 rounded-md border p-2 text-sm hover:bg-accent active:cursor-grabbing"
						>
							<span
								className="flex h-6 w-6 items-center justify-center rounded text-white"
								style={{ backgroundColor: spec.accent }}
							>
								<spec.icon size={13} />
							</span>
							{spec.label}
						</button>
					))}
				</div>

				<div className="relative min-w-0 flex-1">
					<ReactFlow
						nodes={nodes}
						edges={edges}
						nodeTypes={nodeTypes}
						onNodesChange={onNodesChange}
						onEdgesChange={onEdgesChange}
						onConnect={onConnect}
						onDrop={onDrop}
						onDragOver={(event) => {
							event.preventDefault();
							event.dataTransfer.dropEffect = "move";
						}}
						onNodeClick={(_, node) => setSelectedId(node.id)}
						onPaneClick={() => setSelectedId(null)}
						fitView
					>
						<Background />
						<Controls />
						<MiniMap pannable zoomable />
					</ReactFlow>

					{deployOpen && (
						<DeployPanel
							projectId={projectId}
							action={deployAction}
							onClose={() => setDeployOpen(false)}
						/>
					)}

					{preview && (
						<CompilePreview
							result={preview}
							onClose={() => setPreview(null)}
						/>
					)}

					{versionsOpen && (
						<GraphVersions
							projectId={projectId}
							onLoad={handleVersionLoad}
							onClose={() => setVersionsOpen(false)}
						/>
					)}
				</div>

				<ConfigPanel
					spec={selectedSpec}
					nodeId={selectedNode?.id ?? null}
					nodeLabel={selectedNode?.data.label ?? ""}
					config={selectedNode?.data.config ?? {}}
					onChangeLabel={(label) => updateSelectedData({ label })}
					onChangeConfig={(key, value) =>
						updateSelectedData({
							config: { ...(selectedNode?.data.config ?? {}), [key]: value },
						})
					}
				/>
			</div>
		</div>
	);
}
