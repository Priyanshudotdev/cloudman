"use client";

import { Button } from "@my-better-t-app/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@my-better-t-app/ui/components/card";
import { Input } from "@my-better-t-app/ui/components/input";
import { Label } from "@my-better-t-app/ui/components/label";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ApiError } from "@/lib/api";
import {
	createRepoProject,
	listServers,
	type ServerDto,
	updateRepoConfig,
} from "@/lib/servers-api";

const STACK_OPTIONS = [
	"auto",
	"next-static",
	"react-vite",
	"next-node",
	"node-express",
	"python-flask",
	"python-django",
	"springboot",
] as const;

export function RepoProjectForm({
	onCreated,
}: {
	onCreated?: (projectId: string) => void;
}) {
	const [name, setName] = useState("");
	const [repoUrl, setRepoUrl] = useState("");
	const [branch, setBranch] = useState("main");
	const [serverId, setServerId] = useState("");
	const [defaultStack, setDefaultStack] = useState<string>("auto");
	const [servers, setServers] = useState<ServerDto[]>([]);
	const [loadingServers, setLoadingServers] = useState(true);
	const [creating, setCreating] = useState(false);

	useEffect(() => {
		let cancelled = false;
		async function load() {
			try {
				const result = await listServers();
				if (!cancelled) setServers(result);
			} catch (error) {
				if (!cancelled) {
					toast.error(
						error instanceof Error ? error.message : "Failed to load servers",
					);
				}
			} finally {
				if (!cancelled) setLoadingServers(false);
			}
		}
		void load();
		return () => {
			cancelled = true;
		};
	}, []);

	async function submit() {
		setCreating(true);
		try {
			const trimmedBranch = branch.trim();
			const project = await createRepoProject({
				name: name.trim(),
				repoUrl: repoUrl.trim(),
				...(trimmedBranch ? { repoBranch: trimmedBranch } : {}),
				...(defaultStack !== "auto" ? { defaultStack } : {}),
				...(serverId ? { serverId } : {}),
			});
			// POST /api/projects accepts serverId inline; attach via repo-config
			// only if it was not stored.
			if (serverId && !project.repo?.serverId) {
				await updateRepoConfig(project._id, { serverId });
			}
			toast.success("Repo project created");
			setName("");
			setRepoUrl("");
			setBranch("main");
			setServerId("");
			setDefaultStack("auto");
			onCreated?.(project._id);
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

	return (
		<Card>
			<CardHeader className="pb-2">
				<CardTitle className="text-base">New repo project</CardTitle>
				<CardDescription>
					Point CloudMan at a git repo and pick the SSH host it deploys to.
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-3">
				<div className="grid gap-1.5">
					<Label htmlFor="repo-name">Name</Label>
					<Input
						id="repo-name"
						placeholder="e.g. marketing-site"
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor="repo-url">Repo URL</Label>
					<Input
						id="repo-url"
						className="font-mono text-xs"
						placeholder="https://github.com/acme/marketing-site"
						value={repoUrl}
						onChange={(event) => setRepoUrl(event.target.value)}
					/>
				</div>
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="grid gap-1.5">
						<Label htmlFor="repo-branch">Branch</Label>
						<Input
							id="repo-branch"
							className="font-mono text-xs"
							placeholder="main"
							value={branch}
							onChange={(event) => setBranch(event.target.value)}
						/>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="repo-stack">Default stack</Label>
						<select
							id="repo-stack"
							className="h-9 rounded-md border bg-background px-3 text-sm"
							value={defaultStack}
							onChange={(event) => setDefaultStack(event.target.value)}
						>
							{STACK_OPTIONS.map((option) => (
								<option key={option} value={option}>
									{option === "auto" ? "auto (detect)" : option}
								</option>
							))}
						</select>
					</div>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor="repo-server">Target server</Label>
					<select
						id="repo-server"
						className="h-9 rounded-md border bg-background px-3 text-sm"
						value={serverId}
						disabled={loadingServers}
						onChange={(event) => setServerId(event.target.value)}
					>
						<option value="">
							{loadingServers ? "Loading servers..." : "No server yet"}
						</option>
						{servers.map((server) => (
							<option key={server._id} value={server._id}>
								{server.label} ({server.host}:{server.port})
							</option>
						))}
					</select>
					{!loadingServers && servers.length === 0 && (
						<p className="text-muted-foreground text-xs">
							No servers registered yet — add one in Settings → Servers, then
							attach it later.
						</p>
					)}
				</div>
				<Button
					disabled={creating || !name.trim() || !repoUrl.trim()}
					onClick={() => void submit()}
				>
					{creating ? "Creating..." : "Create repo project"}
				</Button>
			</CardContent>
		</Card>
	);
}
