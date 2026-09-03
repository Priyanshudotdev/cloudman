"use client";

import {
	Background,
	BackgroundVariant,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@xyflow/react/dist/style.css";

import { Badge } from "@my-better-t-app/ui/components/badge";
import { Button } from "@my-better-t-app/ui/components/button";
import { toast } from "sonner";
import type {
	CompileResultDto,
	GenerateResultDto,
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
		markerEnd: { type: MarkerType.ArrowClosed, color: "#d0d0d0" },
		style: { stroke: "#d0d0d0", strokeWidth: 1.8 },
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
	const [editingName, setEditingName] = useState(false);
	const [draftName, setDraftName] = useState("");
	const nameInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (editingName) nameInputRef.current?.focus();
	}, [editingName]);
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
	const [generatePrompt, setGeneratePrompt] = useState("");
	const [generating, setGenerating] = useState(false);

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
						markerEnd: { type: MarkerType.ArrowClosed, color: "#d0d0d0" },
						style: { stroke: "#d0d0d0", strokeWidth: 1.8 },
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

	const removeNode = useCallback(
		(id: string) => {
			setNodes((current) => current.filter((node) => node.id !== id));
			setEdges((current) =>
				current.filter((edge) => edge.source !== id && edge.target !== id),
			);
			setSelectedId((current) => (current === id ? null : current));
			setIssues([]);
		},
		[setNodes, setEdges],
	);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (!selectedId) return;
			if (event.key === "Delete" || event.key === "Backspace") {
				const target = event.target as HTMLElement | null;
				if (
					target &&
					(target.tagName === "INPUT" ||
						target.tagName === "TEXTAREA" ||
						target.tagName === "SELECT" ||
						target.isContentEditable)
				) {
					return;
				}
				event.preventDefault();
				removeNode(selectedId);
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [selectedId, removeNode]);

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

	async function handleGenerate() {
		const prompt = generatePrompt.trim();
		if (prompt.length < 3) {
			toast.error("Describe the stack in a few words first");
			return;
		}
		setGenerating(true);
		try {
			const result = await api<GenerateResultDto>("/api/generate", {
				method: "POST",
				body: JSON.stringify({ prompt }),
			});
			const flow = flowFromGraph(result.graph);
			setNodes(flow.nodes);
			setEdges(flow.edges);
			setSelectedId(null);
			setIssues([]);
			setPreview(null);
			const label = result.mode === "llm" ? "AI-generated" : result.blueprint;
			toast.success(
				`Loaded ${label} stack (${result.graph.nodes.length} resources, unsaved)`,
			);
			for (const warning of result.warnings) {
				console.warn("[generate]", warning);
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Generation failed");
		} finally {
			setGenerating(false);
		}
	}

	async function handleRename() {
		const name = draftName.trim();
		if (!name) {
			setDraftName(projectName);
			setEditingName(false);
			return;
		}
		try {
			const { project } = await api<{ project: ProjectDto }>(
				`/api/projects/${projectId}`,
				{ method: "PUT", body: JSON.stringify({ name }) },
			);
			setProjectName(project.name);
			toast.success("Project renamed");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to rename project",
			);
		} finally {
			setEditingName(false);
		}
	}

	const selectedSpec: ResourceUiSpec | null = selectedNode
		? (RESOURCE_SPECS[selectedNode.data.resourceType] ?? null)
		: null;

	if (loading) {
		return (
			<div className="flex h-full items-center justify-center bg-[#1e1e1e] text-sm text-white/60">
				Loading canvas…
			</div>
		);
	}

	return (
		<div className="relative flex h-full min-h-0 flex-col bg-[#1e1e1e]">
			{/* n8n top bar */}
			<div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/10 bg-[#2e2e2e] px-3 text-white">
				<Link
					href="/dashboard"
					className="shrink-0 text-xs text-white/60 hover:text-white"
				>
					← Projects
				</Link>
				<div className="mx-1 h-4 w-px shrink-0 bg-white/10" />
				{editingName ? (
					<input
						ref={nameInputRef}
						value={draftName}
						onChange={(event) => setDraftName(event.target.value)}
						onBlur={() => void handleRename()}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								void handleRename();
							}
							if (event.key === "Escape") {
								setDraftName(projectName);
								setEditingName(false);
							}
						}}
						className="h-6 min-w-0 max-w-52 rounded-md border border-white/20 bg-[#1e1e1e] px-2 text-sm font-medium text-white focus:border-white/40 focus:outline-none"
					/>
				) : (
					<button
						type="button"
						title="Rename project"
						onClick={() => {
							setDraftName(projectName);
							setEditingName(true);
						}}
						className={
							projectName === "Untitled project"
								? "min-w-0 truncate text-sm font-medium italic text-white/60 hover:text-white"
								: "min-w-0 truncate text-sm font-medium text-white hover:text-white/80"
						}
					>
						{projectName === "Untitled project"
							? "Name this project…"
							: projectName}
					</button>
				)}
				{version > 0 && (
					<Badge variant="secondary" className="h-5 bg-white/10 px-1.5 text-[10px] font-normal text-white/70">
						v{version}
					</Badge>
				)}
				<span className="hidden text-xs text-white/40 sm:inline">
					· {nodes.length} nodes · {edges.length} connections
				</span>

				{/* center: Editor / Executions */}
				<div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 lg:flex">
					<div className="flex rounded-md bg-[#1e1e1e] p-0.5">
						<span className="rounded bg-white px-3 py-1 text-xs font-medium text-[#1a1a1a]">Editor</span>
						<button
							type="button"
							className="px-3 py-1 text-xs text-white/50 hover:text-white/80"
							onClick={() => toast.info("Executions coming soon")}
						>
							Executions
						</button>
					</div>
				</div>

				<div className="ml-auto flex items-center gap-1.5">
					<form
						className="hidden items-center gap-1.5 sm:flex"
						onSubmit={(event) => {
							event.preventDefault();
							void handleGenerate();
						}}
					>
						<input
							value={generatePrompt}
							onChange={(event) => setGeneratePrompt(event.target.value)}
							placeholder="Describe a stack…"
							disabled={generating || busy}
							className="h-7 w-36 rounded-md border border-white/10 bg-[#1e1e1e] px-2.5 text-xs text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none disabled:opacity-50 lg:w-48"
						/>
						<Button
							type="submit"
							variant="outline"
							size="sm"
							disabled={generating || busy}
							className="h-7 border-white/10 bg-transparent px-2.5 text-xs text-white hover:bg-white/10 hover:text-white"
						>
							{generating ? "…" : "Generate"}
						</Button>
					</form>
					<div className="hidden h-4 w-px bg-white/10 sm:block" />
					<Button
						variant="ghost"
						size="sm"
						disabled={busy}
						onClick={() => setVersionsOpen(true)}
						className="hidden h-7 text-xs text-white/70 hover:bg-white/10 hover:text-white sm:inline-flex"
					>
						Versions
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => void handleValidate()}
						className="h-7 border-white/10 bg-transparent text-xs text-white hover:bg-white/10 hover:text-white"
					>
						Validate
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => void handleSave()}
						className="h-7 border-white/10 bg-transparent text-xs text-white hover:bg-white/10 hover:text-white"
					>
						Save
					</Button>
					<Button
						variant="destructive"
						size="sm"
						disabled={busy}
						onClick={() => void handleDeploy("destroy")}
						className="h-7 bg-[#4a1a1a] text-xs text-red-200 hover:bg-[#5a2020]"
					>
						Destroy
					</Button>
					<Button
						size="sm"
						disabled={busy}
						onClick={() => void handleDeploy("provision")}
						className="h-7 bg-brand px-3 text-xs font-medium text-brand-foreground hover:bg-brand/90"
					>
						Deploy
					</Button>
				</div>
			</div>

			{issues.length > 0 && (
				<div className="border-b border-red-900/50 bg-[#3a1a1a] px-4 py-2">
					<p className="mb-1 text-xs font-semibold text-red-300">
						{issues.length} validation issue(s)
					</p>
					<ul className="space-y-0.5 font-mono text-[11px] text-red-300/80">
						{issues.map((issue, index) => (
							<li key={`${issue.code}-${index}`}>{issue.message}</li>
						))}
					</ul>
				</div>
			)}

			<div className="flex min-h-0 flex-1">
				{/* n8n left palette — dark */}
				<div className="hidden w-52 shrink-0 flex-col overflow-y-auto border-r border-white/10 bg-[#2e2e2e] p-2 sm:flex">
					<p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-widest text-white/40">
						Resources
					</p>
					<div className="flex flex-col gap-1">
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
								className="flex items-center gap-2 rounded-md border border-white/5 bg-[#3a3a3a] px-2 py-1.5 text-left text-xs text-white/80 hover:border-white/10 hover:bg-[#404040] active:cursor-grabbing"
							>
								<span
									className="flex size-6 shrink-0 items-center justify-center rounded text-white"
									style={{ backgroundColor: spec.accent }}
								>
									<spec.icon size={12} />
								</span>
								<span className="truncate">{spec.label}</span>
							</button>
						))}
					</div>
					<p className="px-1 pt-4 text-[10px] leading-snug text-white/30">
						Drag onto canvas to add. Connect with handles.
					</p>
				</div>

				<div className="relative min-w-0 flex-1 bg-[#1e1e1e]">
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
						className="bg-[#1e1e1e]"
						defaultEdgeOptions={{
							markerEnd: { type: MarkerType.ArrowClosed, color: "#d0d0d0" },
							style: { stroke: "#d0d0d0", strokeWidth: 1.8 },
						}}
					>
						<Background
							variant={BackgroundVariant.Dots}
							gap={18}
							size={1.2}
							color="#3a3a3a"
						/>
						<Controls className="!border-white/10 [&_button]:!border-white/10 [&_button]:!bg-[#2e2e2e] [&_button]:!text-white/70 [&_button:hover]:!bg-[#3a3a3a]" />
						<MiniMap
							pannable
							zoomable
							className="!border-white/10 !bg-[#2e2e2e]"
							maskColor="rgba(30,30,30,0.7)"
							nodeColor="#3a3a3a"
						/>
					</ReactFlow>

					{/* n8n add node (+) floating button — top right of canvas */}
					<button
						type="button"
						className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-md border border-white/10 bg-[#2e2e2e] text-white/70 shadow hover:bg-[#3a3a3a] hover:text-white"
						title="Add node (drag from left)"
						onClick={() => toast.info("Drag a resource from the left palette")}
					>
						<span className="text-sm leading-none">+</span>
					</button>

					{deployOpen && (
						<DeployPanel
							projectId={projectId}
							action={deployAction}
							onClose={() => setDeployOpen(false)}
						/>
					)}

					{preview && (
						<CompilePreview result={preview} onClose={() => setPreview(null)} />
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
					onRemove={() => {
						if (selectedId) removeNode(selectedId);
					}}
				/>
			</div>
		</div>
	);
}
