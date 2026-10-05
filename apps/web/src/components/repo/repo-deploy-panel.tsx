"use client";

import { Badge } from "@my-better-t-app/ui/components/badge";
import { Button } from "@my-better-t-app/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@my-better-t-app/ui/components/card";
import { Label } from "@my-better-t-app/ui/components/label";
import { Skeleton } from "@my-better-t-app/ui/components/skeleton";
import { ExternalLink, GitBranch } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ApiError } from "@/lib/api";
import {
	CANCELLABLE_REPO_STATUSES,
	cancelRepoDeployment,
	createRepoDeployment,
	getRepoDeployment,
	getRepoProject,
	listRepoDeployments,
	REPO_TERMINAL_STATUSES,
	RETRYABLE_REPO_STATUSES,
	type RepoDeploymentDto,
	type RepoProjectDto,
	retryRepoDeployment,
} from "@/lib/servers-api";

type BadgeVariant = NonNullable<React.ComponentProps<typeof Badge>["variant"]>;

function statusVariant(status: string): BadgeVariant {
	if (status === "completed") return "default";
	if (status === "failed") return "destructive";
	if (status === "canceled") return "outline";
	return "secondary";
}

function fmtDate(value?: string): string {
	return value ? new Date(value).toLocaleString() : "—";
}

export function RepoDeployPanel({ projectId }: { projectId: string }) {
	const [project, setProject] = useState<RepoProjectDto | null>(null);
	const [loadingProject, setLoadingProject] = useState(true);
	const [history, setHistory] = useState<RepoDeploymentDto[]>([]);
	const [current, setCurrent] = useState<RepoDeploymentDto | null>(null);
	const [deploying, setDeploying] = useState(false);
	const [retrying, setRetrying] = useState(false);
	const [cancelling, setCancelling] = useState(false);
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const currentIdRef = useRef<string | null>(null);

	const handleActionError = useCallback((error: unknown, fallback: string) => {
		if (error instanceof ApiError && error.issues) {
			toast.error(error.issues.map((issue) => issue.message).join("\n"));
			return;
		}
		toast.error(error instanceof Error ? error.message : fallback);
	}, []);

	const stopPolling = useCallback(() => {
		if (pollRef.current) {
			clearInterval(pollRef.current);
			pollRef.current = null;
		}
	}, []);

	const refreshHistory = useCallback(async () => {
		try {
			const deployments = await listRepoDeployments();
			const scoped = deployments.filter(
				(deployment) => String(deployment.projectId) === projectId,
			);
			setHistory(scoped);
			return scoped;
		} catch {
			return null;
		}
	}, [projectId]);

	const tick = useCallback(async () => {
		const id = currentIdRef.current;
		if (!id) return;
		try {
			// Poll the list for status; the single fetch carries the events tail.
			const listed = await listRepoDeployments();
			const match = listed.find((deployment) => deployment._id === id);
			if (!match) return;
			const full = await getRepoDeployment(id);
			setCurrent(full);
			if (REPO_TERMINAL_STATUSES.has(full.status)) {
				stopPolling();
				if (full.status === "completed") {
					toast.success("Repo deployment completed");
				} else if (full.status === "failed") {
					toast.error(full.error ?? "Repo deployment failed");
				} else {
					toast.info("Repo deployment canceled");
				}
				void refreshHistory();
			}
		} catch {
			// Transient failure — keep polling until a terminal status lands.
		}
	}, [refreshHistory, stopPolling]);

	const startPolling = useCallback(
		(id: string) => {
			currentIdRef.current = id;
			stopPolling();
			pollRef.current = setInterval(() => {
				void tick();
			}, 3000);
		},
		[stopPolling, tick],
	);

	useEffect(() => () => stopPolling(), [stopPolling]);

	const load = useCallback(async () => {
		setLoadingProject(true);
		try {
			const loaded = await getRepoProject(projectId);
			setProject(loaded);
		} catch (error) {
			handleActionError(error, "Failed to load project");
		} finally {
			setLoadingProject(false);
		}
		const scoped = await refreshHistory();
		if (scoped && scoped.length > 0) {
			const latest = scoped[0];
			try {
				const full = await getRepoDeployment(latest._id);
				setCurrent(full);
				if (!REPO_TERMINAL_STATUSES.has(full.status)) {
					startPolling(full._id);
				}
			} catch {
				setCurrent(latest);
			}
		}
	}, [projectId, refreshHistory, startPolling, handleActionError]);

	useEffect(() => {
		void load();
	}, [load]);

	async function deploy() {
		setDeploying(true);
		try {
			const deployment = await createRepoDeployment({ projectId });
			setCurrent(deployment);
			toast.success("Repo deployment queued");
			startPolling(deployment._id);
			void refreshHistory();
		} catch (error) {
			handleActionError(error, "Deployment request failed");
		} finally {
			setDeploying(false);
		}
	}

	async function retry() {
		if (!current) return;
		setRetrying(true);
		try {
			await retryRepoDeployment(current._id);
			toast.success("Deployment retry queued");
			startPolling(current._id);
		} catch (error) {
			handleActionError(error, "Retry request failed");
		} finally {
			setRetrying(false);
		}
	}

	async function cancel() {
		if (!current) return;
		setCancelling(true);
		try {
			await cancelRepoDeployment(current._id);
			setCurrent({ ...current, status: "canceled" });
			stopPolling();
			toast.success("Deployment canceled");
			void refreshHistory();
		} catch (error) {
			handleActionError(error, "Cancel request failed");
		} finally {
			setCancelling(false);
		}
	}

	const active =
		current !== null && !REPO_TERMINAL_STATUSES.has(current.status);
	const retryable =
		current !== null && RETRYABLE_REPO_STATUSES.has(current.status);
	const cancellable =
		current !== null && CANCELLABLE_REPO_STATUSES.has(current.status);
	const events = current?.events ?? [];

	return (
		<Card>
			<CardHeader className="pb-2">
				<div className="flex items-center gap-2">
					<GitBranch className="size-4 text-muted-foreground" />
					<CardTitle className="text-base">Repo deploy</CardTitle>
					{current && (
						<Badge variant={statusVariant(current.status)}>
							{current.status.replaceAll("_", " ")}
						</Badge>
					)}
				</div>
				<CardDescription>
					{loadingProject ? (
						"Loading repo configuration..."
					) : project?.repo ? (
						<span className="font-mono text-xs">
							{project.repo.url} · {project.repo.branch}
							{project.repo.defaultStack
								? ` · ${project.repo.defaultStack}`
								: ""}
						</span>
					) : (
						"This project has no repo configuration yet."
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-3">
				{loadingProject ? (
					<Skeleton className="h-20 rounded-md" />
				) : (
					<>
						<div className="grid gap-1.5">
							<Label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
								Branch
							</Label>
							<p className="font-mono text-sm">
								{project?.repo?.branch ?? "—"}
							</p>
						</div>
						<Button
							disabled={
								deploying || active || !project?.repo || project.kind !== "repo"
							}
							onClick={() => void deploy()}
						>
							{deploying
								? "Queueing..."
								: active
									? "Deployment running..."
									: "Deploy"}
						</Button>
						{project?.kind !== "repo" && project !== null && (
							<p className="text-muted-foreground text-xs">
								This project is not configured for repo deployments.
							</p>
						)}
					</>
				)}

				{current && (
					<div className="grid gap-2 rounded-md border p-3">
						<div className="grid grid-cols-2 gap-2 text-xs">
							<div>
								<p className="text-muted-foreground">Stack</p>
								<p className="font-mono">{current.stack ?? "—"}</p>
							</div>
							<div>
								<p className="text-muted-foreground">Commit</p>
								<p className="max-w-[180px] truncate font-mono">
									{current.commitSha ?? "—"}
								</p>
							</div>
							<div>
								<p className="text-muted-foreground">Started</p>
								<p>{fmtDate(current.startedAt ?? current.createdAt)}</p>
							</div>
							<div>
								<p className="text-muted-foreground">URL</p>
								{current.url ? (
									<a
										href={current.url}
										target="_blank"
										rel="noreferrer"
										className="inline-flex items-center gap-1 font-mono text-primary hover:underline"
									>
										{current.url}
										<ExternalLink className="size-3" />
									</a>
								) : (
									<p className="font-mono">—</p>
								)}
							</div>
						</div>
						{current.repoPlanSummary && (
							<div className="text-xs">
								<p className="mb-1 text-muted-foreground">Plan summary</p>
								<p className="font-mono">
									+{current.repoPlanSummary.created} ~
									{current.repoPlanSummary.updated} =
									{current.repoPlanSummary.unchanged} unchanged
								</p>
								{current.repoPlanSummary.changed.length > 0 && (
									<ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto font-mono text-[11px] text-muted-foreground">
										{current.repoPlanSummary.changed
											.slice(0, 20)
											.map((path) => (
												<li key={path}>{path}</li>
											))}
									</ul>
								)}
							</div>
						)}
						{current.error && (
							<p className="text-destructive text-xs">{current.error}</p>
						)}
						<div className="flex items-center gap-1.5">
							{retryable && (
								<Button
									size="sm"
									variant="outline"
									disabled={retrying}
									onClick={() => void retry()}
								>
									{retrying ? "Retrying..." : "Retry"}
								</Button>
							)}
							{cancellable && (
								<Button
									size="sm"
									variant="outline"
									disabled={cancelling}
									onClick={() => void cancel()}
								>
									{cancelling ? "Cancelling..." : "Cancel"}
								</Button>
							)}
						</div>
						<div className="max-h-48 space-y-1 overflow-y-auto rounded-md bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">
							{events.length === 0 && (
								<p className="text-muted-foreground">
									Waiting for worker events...
								</p>
							)}
							{events.map((event, index) => (
								<p
									key={`${event.at}-${index}`}
									className={
										event.level === "error"
											? "text-destructive"
											: event.level === "success"
												? "text-success"
												: "text-muted-foreground"
									}
								>
									{event.level === "success" ? "✓ " : ""}
									{event.message}
								</p>
							))}
						</div>
					</div>
				)}

				{history.length > 1 && (
					<div className="grid gap-1.5">
						<Label className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
							History
						</Label>
						<ul className="space-y-1">
							{history.slice(0, 5).map((deployment) => (
								<li
									key={deployment._id}
									className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs"
								>
									<span className="font-mono text-muted-foreground">
										{deployment.repoBranch ?? "—"} ·{" "}
										{fmtDate(deployment.createdAt)}
									</span>
									<Badge variant={statusVariant(deployment.status)}>
										{deployment.status.replaceAll("_", " ")}
									</Badge>
								</li>
							))}
						</ul>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
