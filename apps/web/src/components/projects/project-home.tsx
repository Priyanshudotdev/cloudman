"use client";

import { Button, buttonVariants } from "@my-better-t-app/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@my-better-t-app/ui/components/card";
import { Input } from "@my-better-t-app/ui/components/input";
import type { Route } from "next";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { DeploymentHistory } from "@/components/deployments/deployment-history";
import type { AnalyticsStatsDto, ProjectDto } from "@/lib/api";
import { ApiError, api } from "@/lib/api";

const STAT_CARDS: Array<{
	label: string;
	key: keyof AnalyticsStatsDto["stats"];
	format?: (value: number | null) => string;
}> = [
	{ label: "Projects", key: "projects" },
	{ label: "Deployments", key: "deployments" },
	{
		label: "Success rate",
		key: "successRate",
		format: (value) => (value === null ? "n/a" : `${value}%`),
	},
	{ label: "Resources managed", key: "resourcesManaged" },
];

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
		} catch {
			setStats(null);
		}
	}, []);

	useEffect(() => {
		void loadProjects();
		void loadStats();
	}, [loadProjects, loadStats]);

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

	return (
		<div className="container mx-auto max-w-4xl px-4 py-8">
			<h1 className="mb-1 font-semibold text-xl">Infrastructure projects</h1>
			<p className="mb-6 text-muted-foreground text-sm">
				Design AWS infrastructure on a canvas, review the generated plan,
				deploy.
			</p>

			{stats && (
				<div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
					{STAT_CARDS.map((card) => (
						<div key={card.key} className="rounded-lg border bg-card p-4">
							<p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
								{card.label}
							</p>
							<p className="mt-1 font-semibold text-xl">
								{card.format ? card.format(stats[card.key]) : stats[card.key]}
							</p>
						</div>
					))}
				</div>
			)}

			<div className="mb-6 flex gap-2">
				<Input
					placeholder="New project name"
					value={newName}
					onChange={(event) => setNewName(event.target.value)}
					onKeyDown={(event) => event.key === "Enter" && void createProject()}
				/>
				<Button
					disabled={creating || !newName.trim()}
					onClick={() => void createProject()}
				>
					Create
				</Button>
			</div>

			{loading ? (
				<p className="text-muted-foreground text-sm">Loading projects...</p>
			) : projects.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No projects yet — create one above to start designing infrastructure.
				</p>
			) : (
				<div className="grid gap-3">
					{projects.map((project) => (
						<div key={project._id}>
							<Card>
								<CardHeader className="pb-2">
									<div className="flex items-center justify-between">
										<CardTitle className="text-base">{project.name}</CardTitle>
										{project.latestGraphVersion > 0 && (
											<span className="rounded bg-muted px-2 py-0.5 text-muted-foreground text-xs">
												v{project.latestGraphVersion}
											</span>
										)}
									</div>
									{project.description && (
										<CardDescription>{project.description}</CardDescription>
									)}
								</CardHeader>
								{editingProjectId === project._id ? (
									<CardContent className="grid gap-3 pt-0 pb-3">
										<div className="grid gap-1.5">
											<Input
												aria-label="Project name"
												value={editName}
												onChange={(event) => setEditName(event.target.value)}
											/>
										</div>
										<div className="grid gap-1.5">
											<Input
												aria-label="Project description"
												placeholder="Description (optional)"
												value={editDescription}
												onChange={(event) =>
													setEditDescription(event.target.value)
												}
											/>
										</div>
										<div className="flex justify-end gap-2">
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setEditingProjectId(null)}
											>
												Cancel
											</Button>
											<Button
												size="sm"
												disabled={savingEdit || !editName.trim()}
												onClick={() => void saveEdit(project)}
											>
												{savingEdit ? "Saving..." : "Save changes"}
											</Button>
										</div>
									</CardContent>
								) : (
									<CardContent className="flex items-center justify-between pb-3">
										<span className="text-muted-foreground text-xs">
											Updated {new Date(project.updatedAt).toLocaleString()}
										</span>
										<div className="flex gap-2">
											<Button
												variant="ghost"
												size="sm"
												onClick={() => void beginEdit(project)}
											>
												Edit
											</Button>
											<Button
												variant="ghost"
												size="sm"
												onClick={() =>
													setHistoryProjectId(
														historyProjectId === project._id
															? null
															: project._id,
													)
												}
											>
												History
											</Button>
											<Link
												href={`/projects/${project._id}` as Route}
												className={buttonVariants({
													variant: "outline",
													size: "sm",
												})}
											>
												Open canvas
											</Link>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => void deleteProject(project)}
											>
												Delete
											</Button>
										</div>
									</CardContent>
								)}
							</Card>
							{historyProjectId === project._id && (
								<DeploymentHistory
									projectId={project._id}
									onClose={() => setHistoryProjectId(null)}
								/>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
