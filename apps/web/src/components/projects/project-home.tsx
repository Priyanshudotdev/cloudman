"use client";

import { Button } from "@my-better-t-app/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@my-better-t-app/ui/components/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@my-better-t-app/ui/components/dropdown-menu";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@my-better-t-app/ui/components/empty";
import { Input } from "@my-better-t-app/ui/components/input";
import { Skeleton } from "@my-better-t-app/ui/components/skeleton";
import {
	Boxes,
	MoreHorizontal,
	Plus,
	Search,
	Sparkles,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { DeploymentHistory } from "@/components/deployments/deployment-history";
import type { AnalyticsStatsDto, BlueprintDto, ProjectDto } from "@/lib/api";
import { ApiError, api } from "@/lib/api";

const STAT_CARDS: Array<{
	label: string;
	key: keyof AnalyticsStatsDto["stats"];
	format?: (value: number | null) => string;
}> = [
	{ label: "Workflows", key: "projects" },
	{ label: "Executions", key: "deployments" },
	{
		label: "Success rate",
		key: "successRate",
		format: (value) => (value === null ? "—" : `${value}%`),
	},
	{ label: "Resources", key: "resourcesManaged" },
	{
		label: "Spend",
		key: "monthlySpendEstimate",
		format: (value) => (value === null ? "—" : `~$${value.toFixed(0)}`),
	},
];

function formatUpdatedAt(value: string) {
	const date = new Date(value);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMinutes = Math.floor(diffMs / 60_000);
	if (diffMinutes < 1) return "just now";
	if (diffMinutes < 60) return `${diffMinutes}m ago`;
	const diffHours = Math.floor(diffMinutes / 60);
	if (diffHours < 24) return `${diffHours}h ago`;
	return date.toLocaleDateString();
}

export function ProjectHome() {
	const [projects, setProjects] = useState<ProjectDto[]>([]);
	const [stats, setStats] = useState<AnalyticsStatsDto["stats"] | null>(null);
	const [loading, setLoading] = useState(true);
	const [newName, setNewName] = useState("");
	const [creating, setCreating] = useState(false);
	const [historyProjectId, setHistoryProjectId] = useState<string | null>(null);
	const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
	const [editName, setEditName] = useState("");
	const [editDescription, setEditDescription] = useState("");
	const [savingEdit, setSavingEdit] = useState(false);
	const [templates, setTemplates] = useState<BlueprintDto[]>([]);
	const [creatingTemplate, setCreatingTemplate] = useState<string | null>(null);
	const [query, setQuery] = useState("");

	const loadTemplates = useCallback(async () => {
		try {
			const result = await api<{ blueprints: BlueprintDto[] }>(
				"/api/blueprints",
			);
			setTemplates(result.blueprints);
		} catch {
			setTemplates([]);
		}
	}, []);

	const loadProjects = useCallback(async () => {
		try {
			const result = await api<{ projects: ProjectDto[] }>("/api/projects");
			setProjects(result.projects);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to load projects",
			);
		} finally {
			setLoading(false);
		}
	}, []);

	const loadStats = useCallback(async () => {
		try {
			const result = await api<AnalyticsStatsDto>("/api/analytics");
			setStats(result.stats);
		} catch (error) {
			toast.error(
				error instanceof ApiError
					? `Analytics: ${error.message}`
					: error instanceof Error
						? error.message
						: "Failed to load analytics",
			);
			setStats(null);
		}
	}, []);

	useEffect(() => {
		void loadProjects();
		void loadStats();
		void loadTemplates();
	}, [loadProjects, loadStats, loadTemplates]);

	async function createProject() {
		if (!newName.trim()) return;
		setCreating(true);
		try {
			await api("/api/projects", {
				method: "POST",
				body: JSON.stringify({ name: newName.trim() }),
			});
			setNewName("");
			toast.success("Project created");
			await loadProjects();
		} catch (error) {
			if (error instanceof ApiError && error.issues) {
				toast.error(error.issues.map((issue) => issue.message).join("\n"));
			} else {
				toast.error(
					error instanceof Error ? error.message : "Failed to create project",
				);
			}
		} finally {
			setCreating(false);
		}
	}

	async function createProjectFromTemplate(blueprint: BlueprintDto) {
		setCreatingTemplate(blueprint.id);
		try {
			const result = await api<{ project: ProjectDto }>("/api/projects", {
				method: "POST",
				body: JSON.stringify({ blueprint: blueprint.id }),
			});
			toast.success(
				`Project created from "${blueprint.name}" template — name it on the canvas`,
			);
			await loadProjects();
			window.location.href = `/projects/${result.project._id}`;
		} catch (error) {
			if (error instanceof ApiError && error.issues) {
				toast.error(error.issues.map((issue) => issue.message).join("\n"));
			} else {
				toast.error(
					error instanceof Error
						? error.message
						: "Failed to create project from template",
				);
			}
		} finally {
			setCreatingTemplate(null);
		}
	}

	function beginEdit(project: ProjectDto) {
		setEditingProjectId(project._id);
		setEditName(project.name);
		setEditDescription(project.description);
	}

	async function saveEdit(project: ProjectDto) {
		setSavingEdit(true);
		try {
			const result = await api<{ project: ProjectDto }>(
				`/api/projects/${project._id}`,
				{
					method: "PUT",
					body: JSON.stringify({
						name: editName.trim() || project.name,
						description: editDescription.trim(),
					}),
				},
			);
			setProjects((current) =>
				current.map((item) =>
					item._id === project._id ? result.project : item,
				),
			);
			setEditingProjectId(null);
			toast.success("Project updated");
		} catch (error) {
			if (error instanceof ApiError && error.issues) {
				toast.error(error.issues.map((issue) => issue.message).join("\n"));
			} else {
				toast.error(
					error instanceof Error ? error.message : "Failed to update project",
				);
			}
		} finally {
			setSavingEdit(false);
		}
	}

	async function deleteProject(project: ProjectDto) {
		const confirmed = window.confirm(
			`Delete project "${project.name}"? This removes its graph history and deployments. Deployed infrastructure must be destroyed first.`,
		);
		if (!confirmed) return;
		try {
			await api(`/api/projects/${project._id}`, { method: "DELETE" });
			setProjects((current) =>
				current.filter((item) => item._id !== project._id),
			);
			toast.success("Project deleted");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to delete project",
			);
		}
	}

	const filtered = projects.filter((p) =>
		query.trim()
			? p.name.toLowerCase().includes(query.toLowerCase()) ||
				p.description.toLowerCase().includes(query.toLowerCase())
			: true,
	);

	return (
		<AppShell>
			{/* main */}
				{/* n8n-style top bar */}
				<div className="flex h-12 shrink-0 items-center gap-3 border-b bg-card px-4 sm:px-6">
					<h1 className="text-sm font-semibold text-foreground">Overview</h1>
					<div className="ml-auto flex items-center gap-2">
						<div className="hidden items-center gap-2 sm:flex">
							<div className="relative">
								<Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
								<Input
									placeholder="Search projects"
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									className="h-8 w-56 bg-muted pl-8 text-xs"
								/>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Input
								placeholder="New project name"
								value={newName}
								onChange={(e) => setNewName(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && void createProject()}
								className="hidden h-8 w-40 text-xs sm:flex"
							/>
							<Button
								size="sm"
								disabled={creating || !newName.trim()}
								onClick={() => void createProject()}
								className="h-8 bg-brand text-white hover:bg-brand/90 disabled:opacity-50"
							>
								<Plus className="size-3.5" />
								Create workflow
							</Button>
						</div>
					</div>
				</div>

				{/* mobile search + create */}
				<div className="flex gap-2 border-b bg-card px-4 py-3 sm:hidden">
					<div className="relative flex-1">
						<Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							placeholder="Search projects"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							className="h-8 bg-muted pl-8 text-xs"
						/>
					</div>
					<Input
						placeholder="Name"
						value={newName}
						onChange={(e) => setNewName(e.target.value)}
						className="h-8 w-28 text-xs"
					/>
				</div>

				<div className="flex-1 overflow-y-auto">
					<div className="mx-auto max-w-6xl p-4 sm:p-6">
						{/* stats — n8n compact pills */}
						<div className="mb-5 flex flex-wrap gap-2">
							{stats
								? STAT_CARDS.map((card) => (
										<div
											key={card.key}
											className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5"
										>
											<span className="text-[11px] font-medium text-muted-foreground">
												{card.label}
											</span>
											<span className="text-xs font-semibold text-foreground">
												{card.format
													? card.format(stats[card.key])
													: stats[card.key]}
											</span>
										</div>
									))
								: Array.from({ length: 5 }).map((_, i) => (
										<Skeleton key={i} className="h-7 w-24 rounded-full" />
									))}
						</div>

						{/* templates — n8n template library look */}
						{templates.length > 0 && (
							<div className="mb-6">
								<div className="mb-3 flex items-center gap-2">
									<Sparkles className="size-3.5 text-muted-foreground" />
									<h2 className="text-xs font-semibold text-foreground">
										Start from a template
									</h2>
									<span className="text-[11px] text-muted-foreground">
										Pre-loaded stack on the canvas
									</span>
								</div>
								<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
									{templates.map((template) => (
										<Card
											key={template.id}
											className="flex flex-col border bg-card shadow-none hover:border-border hover:shadow-sm"
										>
											<CardHeader className="pb-2">
												<div className="flex items-center gap-2">
													<span className="flex size-6 items-center justify-center rounded bg-muted text-muted-foreground">
														<Boxes className="size-3.5" />
													</span>
													<CardTitle className="text-xs font-semibold text-foreground">
														{template.name}
													</CardTitle>
												</div>
												{template.description && (
													<CardDescription className="line-clamp-2 text-[11px] leading-snug">
														{template.description}
													</CardDescription>
												)}
											</CardHeader>
											<CardContent className="mt-auto flex flex-col gap-2 pt-0 pb-3">
												<div className="flex flex-wrap gap-1">
													{template.tags.slice(0, 3).map((tag) => (
														<span
															key={tag}
															className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
														>
															{tag}
														</span>
													))}
												</div>
												<Button
													type="button"
													size="sm"
													disabled={creatingTemplate === template.id}
													onClick={() => void createProjectFromTemplate(template)}
													className="h-7 bg-brand px-3 text-xs text-white hover:bg-brand/90"
												>
													{creatingTemplate === template.id
														? "Creating…"
														: "Use template"}
												</Button>
											</CardContent>
										</Card>
									))}
								</div>
							</div>
						)}

						{/* project list — n8n workflow cards */}
						{loading ? (
							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
								{Array.from({ length: 6 }).map((_, i) => (
									<Skeleton key={i} className="h-28 rounded-lg" />
								))}
							</div>
						) : filtered.length === 0 ? (
							<Empty className="border border-dashed border-border bg-card">
								<EmptyMedia variant="icon" className="bg-muted">
									<Boxes className="size-5 text-muted-foreground" />
								</EmptyMedia>
								<EmptyHeader>
									<EmptyTitle className="text-foreground">
										{query ? "No matches" : "No workflows yet"}
									</EmptyTitle>
									<EmptyDescription>
										{query
											? `No projects match "${query}".`
											: "Create your first project to start designing infrastructure on a canvas."}
									</EmptyDescription>
								</EmptyHeader>
							</Empty>
						) : (
							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
								{filtered.map((project) => (
									<div
										key={project._id}
										className="group relative flex flex-col rounded-lg border bg-card p-4 transition hover:border-border hover:shadow-sm"
									>
										<div className="relative z-10 mb-3 flex items-start justify-between gap-2">
											<Link
												href={`/projects/${project._id}` as Route}
												className="min-w-0 flex-1"
											>
												<h3 className="truncate text-sm font-semibold text-foreground group-hover:text-brand">
													{project.name}
												</h3>
												<p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
													{project.description || "No description"}
												</p>
											</Link>
											<DropdownMenu>
												<DropdownMenuTrigger
													render={
														<Button
															variant="ghost"
															size="icon-sm"
															aria-label="Project actions"
															className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
														>
															<MoreHorizontal className="size-4" />
														</Button>
													}
												/>
												<DropdownMenuContent align="end">
													<DropdownMenuItem onClick={() => void beginEdit(project)}>
														Rename
													</DropdownMenuItem>
													<DropdownMenuItem
														onClick={() =>
															setHistoryProjectId(
																historyProjectId === project._id ? null : project._id,
															)
														}
													>
														Executions
													</DropdownMenuItem>
													<DropdownMenuSeparator />
													<DropdownMenuItem
														variant="destructive"
														onClick={() => void deleteProject(project)}
													>
														Delete
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</div>
										<div className="mt-auto flex items-center gap-2 text-[11px] text-muted-foreground">
											<span className="inline-flex items-center gap-1">
												<span className="size-1.5 rounded-full bg-[#22c55e]" />
												Updated {formatUpdatedAt(project.updatedAt)}
											</span>
											{project.latestGraphVersion > 0 && (
												<span className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
													v{project.latestGraphVersion}
												</span>
											)}
										</div>
										<Link
											href={`/projects/${project._id}` as Route}
											className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
											aria-label={`Open ${project.name}`}
										>
											<span className="sr-only">Open</span>
										</Link>
									</div>
								))}
							</div>
						)}

						{/* inline editor */}
						{editingProjectId &&
							!loading &&
							projects.find((p) => p._id === editingProjectId) && (
								<div className="mt-6 rounded-lg border bg-card p-4 shadow-sm">
									<h2 className="mb-3 text-xs font-semibold text-foreground">Rename workflow</h2>
									<div className="grid gap-3">
										<Input
											aria-label="Project name"
											value={editName}
											onChange={(e) => setEditName(e.target.value)}
											className="bg-muted text-sm"
										/>
										<Input
											aria-label="Project description"
											placeholder="Description (optional)"
											value={editDescription}
											onChange={(e) => setEditDescription(e.target.value)}
											className="bg-muted text-sm"
										/>
										<div className="flex justify-end gap-2">
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setEditingProjectId(null)}
												className="text-muted-foreground"
											>
												Cancel
											</Button>
											<Button
												size="sm"
												disabled={savingEdit || !editName.trim()}
												onClick={() => {
													const project = projects.find((p) => p._id === editingProjectId);
													if (project) void saveEdit(project);
												}}
												className="bg-brand text-white hover:bg-brand/90"
											>
												{savingEdit ? "Saving…" : "Save"}
											</Button>
										</div>
									</div>
								</div>
							)}

						{historyProjectId && (
							<div className="mt-6">
								<DeploymentHistory
									projectId={historyProjectId}
									onClose={() => setHistoryProjectId(null)}
								/>
							</div>
						)}
					</div>
				</div>
		</AppShell>
	);
}
