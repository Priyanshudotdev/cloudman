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

import type { ProjectDto } from "@/lib/api";
import { ApiError, api } from "@/lib/api";

export function ProjectHome() {
	const [projects, setProjects] = useState<ProjectDto[]>([]);
	const [loading, setLoading] = useState(true);
	const [newName, setNewName] = useState("");
	const [creating, setCreating] = useState(false);

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

	useEffect(() => {
		void loadProjects();
	}, [loadProjects]);

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
						<Card key={project._id}>
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
							<CardContent className="flex items-center justify-between pb-3">
								<span className="text-muted-foreground text-xs">
									Updated {new Date(project.updatedAt).toLocaleString()}
								</span>
								<div className="flex gap-2">
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
						</Card>
					))}
				</div>
			)}
		</div>
	);
}
