"use client";

import { Badge } from "@my-better-t-app/ui/components/badge";
import { Button } from "@my-better-t-app/ui/components/button";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
	ApiError,
	api,
	apiUrl,
	type DeploymentDto,
	type DeploymentResourceDto,
} from "@/lib/api";

interface StreamEvent {
	level: "info" | "success" | "error" | "progress";
	message: string;
	status?: string;
	at: string;
}

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

export function DeployPanel({
	projectId,
	onClose,
}: {
	projectId: string;
	onClose: () => void;
}) {
	const [events, setEvents] = useState<StreamEvent[]>([]);
	const [deploymentId, setDeploymentId] = useState<string | null>(null);
	const [status, setStatus] = useState<string>("queued");
	const [planResources, setPlanResources] = useState<DeploymentResourceDto[]>(
		[],
	);
	const [approving, setApproving] = useState(false);
	const sourceRef = useRef<EventSource | null>(null);

	const handleApprovalError = useCallback((error: unknown) => {
		if (error instanceof ApiError && error.issues) {
			toast.error(error.issues.map((issue) => issue.message).join("\n"));
			return;
		}
		toast.error(
			error instanceof Error ? error.message : "Failed to approve deployment",
		);
	}, []);

	useEffect(() => {
		let cancelled = false;

		async function start() {
			try {
				const created = await api<{ deployment: DeploymentDto }>(
					`/api/projects/${projectId}/deployments`,
					{ method: "POST", body: JSON.stringify({}) },
				);
				if (cancelled) return;

				const deploymentId = created.deployment._id;
				setDeploymentId(deploymentId);
				setStatus(created.deployment.status);

				const source = new EventSource(
					`${apiUrl}/api/deployments/${deploymentId}/events`,
					{ withCredentials: true },
				);
				sourceRef.current = source;

				source.addEventListener("deployment", (rawEvent) => {
					const event = JSON.parse(
						(rawEvent as MessageEvent).data,
					) as StreamEvent;
					setEvents((previous) => [...previous, event]);
					if (event.status) setStatus(event.status);
					if (event.status === "awaiting_approval") {
						void api<{ deployment: DeploymentDto }>(
							`/api/deployments/${deploymentId}`,
						)
							.then(({ deployment }) =>
								setPlanResources(deployment.planSummary?.resources ?? []),
							)
							.catch(() => undefined);
					}
					if (TERMINAL_STATUSES.has(event.status ?? "")) {
						source.close();
					}
				});

				source.onerror = () => {
					source.close();
				};
			} catch (error) {
				if (!cancelled) {
					toast.error(
						error instanceof Error
							? error.message
							: "Failed to start deployment",
					);
					setStatus("failed");
				}
			}
		}

		void start();
		return () => {
			cancelled = true;
			sourceRef.current?.close();
		};
	}, [projectId]);

	async function approve() {
		if (!deploymentId) return;
		setApproving(true);
		try {
			await api(`/api/deployments/${deploymentId}/approve`, {
				method: "POST",
				body: JSON.stringify({}),
			});
		} catch (error) {
			handleApprovalError(error);
		} finally {
			setApproving(false);
		}
	}

	return (
		<div className="absolute inset-y-0 right-0 z-20 flex w-96 flex-col border-l bg-card shadow-xl">
			<div className="flex items-center justify-between border-b px-4 py-3">
				<div className="flex items-center gap-2">
					<p className="font-semibold text-sm">Deployment</p>
					<StatusBadge status={status} />
				</div>
				<Button variant="ghost" size="sm" onClick={onClose}>
					Close
				</Button>
			</div>

			{status === "awaiting_approval" && (
				<div className="border-b px-4 py-3">
					<p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
						Plan review
					</p>
					<ul className="mb-3 max-h-40 space-y-1 overflow-y-auto font-mono text-[11px]">
						{planResources.map((resource) => (
							<li key={resource.address}>
								<span className="text-green-600 dark:text-green-400">
									+ {resource.address}
								</span>
							</li>
						))}
					</ul>
					<Button
						className="w-full"
						disabled={approving}
						onClick={() => void approve()}
					>
						{approving ? "Approving..." : "Approve & apply"}
					</Button>
				</div>
			)}

			<div className="flex-1 space-y-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed">
				{events.length === 0 && (
					<p className="text-muted-foreground">Waiting for worker events...</p>
				)}
				{events.map((event, index) => (
					<p
						key={`${event.at}-${index}`}
						className={
							event.level === "error"
								? "text-red-500"
								: event.level === "success"
									? "text-green-600 dark:text-green-400"
									: "text-muted-foreground"
						}
					>
						{event.level === "success" ? "✓ " : ""}
						{event.message}
					</p>
				))}
			</div>
		</div>
	);
}

function StatusBadge({ status }: { status: string }) {
	const variant =
		status === "completed"
			? "default"
			: status === "failed"
				? "destructive"
				: "secondary";
	return <Badge variant={variant}>{status.replaceAll("_", " ")}</Badge>;
}
