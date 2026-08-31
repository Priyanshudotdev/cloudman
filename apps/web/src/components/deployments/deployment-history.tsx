"use client";

import { Badge } from "@my-better-t-app/ui/components/badge";
import { Button } from "@my-better-t-app/ui/components/button";
import { Skeleton } from "@my-better-t-app/ui/components/skeleton";
import { cn } from "@my-better-t-app/ui/lib/utils";
import { RotateCcw, RotateCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { DeploymentDto } from "@/lib/api";
import { api } from "@/lib/api";

type BadgeVariant = NonNullable<React.ComponentProps<typeof Badge>["variant"]>;

export function statusLabel(status: string): string {
	return status
		.replaceAll("_", " ")
		.replace(/^\w/, (char) => char.toUpperCase());
}

export function statusVariant(status: string): BadgeVariant {
	if (status === "completed") return "default";
	if (status === "failed") return "destructive";
	if (status === "canceled") return "outline";
	if (status === "awaiting_approval") return "secondary";
	return "secondary";
}

const levelIcon: Record<string, string> = {
	info: "text-muted-foreground",
	progress: "text-sky-600 dark:text-sky-400",
	success: "text-emerald-600 dark:text-emerald-400",
	error: "text-destructive",
};

function fmtDate(value?: string): string {
	return value ? new Date(value).toLocaleString() : "—";
}

function planTotals(deployment: DeploymentDto): number | null {
	const plan = deployment.planSummary;
	if (!plan) return null;
	return plan.create + plan.update + plan.destroy;
}

export function DeploymentHistory({
	projectId,
	onClose,
}: {
	projectId: string;
	onClose: () => void;
}) {
	const [deployments, setDeployments] = useState<DeploymentDto[] | null>(null);
	const [details, setDetails] = useState<Record<string, DeploymentDto>>({});
	const [expanded, setExpanded] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(true);
	const [retrying, setRetrying] = useState<string | null>(null);

	const load = useCallback(async () => {
		setRefreshing(true);
		try {
			const result = await api<{ deployments: DeploymentDto[] }>(
				`/api/projects/${projectId}/deployments`,
			);
			setDeployments(result.deployments);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to load deployments",
			);
		} finally {
			setRefreshing(false);
		}
	}, [projectId]);

	useEffect(() => {
		void load();
	}, [load]);

	async function toggleDetail(id: string) {
		if (expanded === id) {
			setExpanded(null);
			return;
		}
		if (!details[id]) {
			try {
				const result = await api<{ deployment: DeploymentDto }>(
					`/api/deployments/${id}`,
				);
				setDetails((current) => ({ ...current, [id]: result.deployment }));
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : "Failed to load deployment",
				);
			}
		}
		setExpanded(id);
	}

	async function retryDeployment(id: string) {
		setRetrying(id);
		try {
			await api(`/api/deployments/${id}/retry`, { method: "POST" });
			toast.success("Deployment requeued");
			await load();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to retry deployment",
			);
		} finally {
			setRetrying(null);
		}
	}

	return (
		<div className="rounded-md border bg-card p-4 text-sm">
			<div className="mb-3 flex items-center justify-between">
				<h3 className="font-semibold">Deployment history</h3>
				<div className="flex gap-1">
					<Button
						variant="ghost"
						size="sm"
						disabled={refreshing}
						onClick={() => void load()}
						aria-label="Refresh deployments"
					>
						<RotateCw className={cn("size-4", refreshing && "animate-spin")} />
					</Button>
					<Button variant="ghost" size="sm" onClick={onClose}>
						Close
					</Button>
				</div>
			</div>

			{deployments === null ? (
				<div className="space-y-2">
					<Skeleton className="h-8 w-full" />
					<Skeleton className="h-8 w-full" />
				</div>
			) : deployments.length === 0 ? (
				<p className="text-muted-foreground">
					No deployments yet — open the project canvas and deploy the graph.
				</p>
			) : (
				<ul className="divide-y">
					{deployments.map((deployment) => {
						const total = planTotals(deployment);
						const isOpen = expanded === deployment._id;
						const detail = details[deployment._id];
						return (
							<li key={deployment._id}>
								<button
									type="button"
									onClick={() => void toggleDetail(deployment._id)}
									className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-muted/50"
								>
									<div className="flex items-center gap-2">
										<Badge variant={statusVariant(deployment.status)}>
											{statusLabel(deployment.status)}
										</Badge>
										<span
											className={cn(
												"font-medium",
												deployment.action === "destroy" && "text-destructive",
											)}
										>
											{deployment.action === "destroy"
												? "Destroy"
												: "Provision"}
										</span>
										{(deployment.status === "failed" ||
											deployment.status === "canceled") && (
											<Button
												variant="ghost"
												size="sm"
												disabled={retrying === deployment._id}
												onClick={(e) => {
													e.stopPropagation();
													void retryDeployment(deployment._id);
												}}
												className="h-6 px-1.5 text-xs"
											>
												<RotateCcw className="mr-1 size-3" />
												{retrying === deployment._id ? "Retrying..." : "Retry"}
											</Button>
										)}
										{total !== null && (
											<span className="text-muted-foreground">
												{total} resource{total === 1 ? "" : "s"}
											</span>
										)}
										{deployment.action === "provision" &&
											(deployment.estimatedMonthlyCost ?? 0) > 0 && (
												<span className="text-muted-foreground text-xs">
													~${deployment.estimatedMonthlyCost?.toFixed(2)}/mo
												</span>
											)}
									</div>
									<span className="text-muted-foreground text-xs">
										{fmtDate(deployment.createdAt)}
									</span>
								</button>

								{isOpen && (
									<div className="space-y-2 pb-3 text-xs">
										<div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
											<span>
												Region:{" "}
												<span className="text-foreground">
													{deployment.region ?? "us-east-1"}
												</span>
											</span>
											<span>
												Started:{" "}
												<span className="text-foreground">
													{fmtDate(deployment.startedAt)}
												</span>
											</span>
											<span>
												Completed:{" "}
												<span className="text-foreground">
													{fmtDate(deployment.completedAt)}
												</span>
											</span>
											{deployment.planSummary && (
												<span>
													Plan:{" "}
													<span
														className={cn(
															deployment.planSummary.create > 0 &&
																"text-emerald-600 dark:text-emerald-400",
														)}
													>
														+{deployment.planSummary.create}
													</span>{" "}
													<span
														className={cn(
															deployment.planSummary.update > 0 &&
																"text-sky-600 dark:text-sky-400",
														)}
													>
														~{deployment.planSummary.update}
													</span>{" "}
													<span
														className={cn(
															deployment.planSummary.destroy > 0 &&
																"text-destructive",
														)}
													>
														-{deployment.planSummary.destroy}
													</span>
												</span>
											)}
										</div>

										{detail?.error && (
											<p className="text-destructive">{detail.error}</p>
										)}

										{(detail?.events?.length ?? 0) > 0 && (
											<ul className="space-y-1 border-t pt-2">
												{detail?.events?.map((event, index) => (
													<li key={index} className="flex gap-2">
														<span
															className={cn(
																"shrink-0 tabular-nums",
																levelIcon[event.level] ?? levelIcon.info,
															)}
														>
															{new Date(event.at).toLocaleTimeString()}
														</span>
														<span>{event.message}</span>
													</li>
												))}
											</ul>
										)}

										{!detail && (
											<span className="inline-block animate-pulse text-muted-foreground">
												Loading details...
											</span>
										)}
									</div>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
