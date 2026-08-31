"use client";

import { Badge } from "@my-better-t-app/ui/components/badge";
import { Button } from "@my-better-t-app/ui/components/button";
import { Label } from "@my-better-t-app/ui/components/label";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
	ApiError,
	type AwsConnectionDto,
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

const TERMINAL_STATUSES = new Set(["completed", "failed", "canceled"]);

const AWS_REGIONS = [
	"us-east-1",
	"us-east-2",
	"us-west-1",
	"us-west-2",
	"eu-west-1",
	"eu-west-2",
	"eu-central-1",
	"ap-south-1",
	"ap-southeast-1",
	"ap-northeast-1",
	"sa-east-1",
];

export function DeployPanel({
	projectId,
	action,
	onClose,
}: {
	projectId: string;
	action: "provision" | "destroy";
	onClose: () => void;
}) {
	const [phase, setPhase] = useState<"setup" | "running">("setup");
	const [connections, setConnections] = useState<AwsConnectionDto[]>([]);
	const [loadingConnections, setLoadingConnections] = useState(true);
	const [selectedConnectionId, setSelectedConnectionId] = useState<
		string | null
	>(null);
	const [region, setRegion] = useState("us-east-1");
	const [starting, setStarting] = useState(false);

	const [deploymentId, setDeploymentId] = useState<string | null>(null);
	const [events, setEvents] = useState<StreamEvent[]>([]);
	const [status, setStatus] = useState<string>("queued");
	const [planResources, setPlanResources] = useState<DeploymentResourceDto[]>(
		[],
	);
	const [approving, setApproving] = useState(false);
	const [cancelling, setCancelling] = useState(false);
	const sourceRef = useRef<EventSource | null>(null);
	const isDestroy = action === "destroy";

	useEffect(() => {
		let cancelled = false;
		async function load() {
			try {
				const result = await api<{ connections: AwsConnectionDto[] }>(
					"/api/aws-connections",
				);
				if (!cancelled) setConnections(result.connections);
			} catch {
				if (!cancelled) setConnections([]);
			} finally {
				if (!cancelled) setLoadingConnections(false);
			}
		}
		void load();
		return () => {
			cancelled = true;
		};
	}, []);

	const handleStreamError = useCallback((error: unknown) => {
		if (error instanceof ApiError && error.issues) {
			toast.error(error.issues.map((issue) => issue.message).join("\n"));
			return;
		}
		toast.error(
			error instanceof Error ? error.message : "Deployment request failed",
		);
	}, []);

	function startStreaming(id: string) {
		const source = new EventSource(`${apiUrl}/api/deployments/${id}/events`, {
			withCredentials: true,
		});
		sourceRef.current = source;

		source.addEventListener("deployment", (rawEvent) => {
			const event = JSON.parse((rawEvent as MessageEvent).data) as StreamEvent;
			setEvents((previous) => [...previous, event]);
			if (event.status) setStatus(event.status);
			if (event.status === "awaiting_approval") {
				void api<{ deployment: DeploymentDto }>(`/api/deployments/${id}`)
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
	}

	async function startDeployment() {
		setStarting(true);
		try {
			const created = await api<{ deployment: DeploymentDto }>(
				`/api/projects/${projectId}/deployments`,
				{
					method: "POST",
					body: JSON.stringify({
						action,
						region: region.trim() || "us-east-1",
						...(selectedConnectionId
							? { awsConnectionId: selectedConnectionId }
							: {}),
					}),
				},
			);
			setDeploymentId(created.deployment._id);
			setStatus(created.deployment.status);
			setPhase("running");
			startStreaming(created.deployment._id);
		} catch (error) {
			handleStreamError(error);
		} finally {
			setStarting(false);
		}
	}

	async function approve() {
		if (!deploymentId) return;
		setApproving(true);
		try {
			await api(`/api/deployments/${deploymentId}/approve`, {
				method: "POST",
				body: JSON.stringify({}),
			});
		} catch (error) {
			handleStreamError(error);
		} finally {
			setApproving(false);
		}
	}

	const CANCELLABLE = new Set([
		"queued",
		"initializing",
		"planning",
		"planned",
		"awaiting_approval",
	]);

	async function cancel() {
		if (!deploymentId) return;
		setCancelling(true);
		try {
			await api(`/api/deployments/${deploymentId}/cancel`, {
				method: "POST",
				body: JSON.stringify({}),
			});
			setStatus("canceled");
			sourceRef.current?.close();
		} catch (error) {
			handleStreamError(error);
		} finally {
			setCancelling(false);
		}
	}

	return (
		<div className="absolute inset-y-0 right-0 z-20 flex w-96 flex-col border-l bg-card shadow-xl">
			<div className="flex items-center justify-between border-b px-4 py-3">
				<div className="flex items-center gap-2">
					<p className="font-semibold text-sm">
						{isDestroy ? "Destroy infrastructure" : "Deploy infrastructure"}
					</p>
					{phase === "running" && <StatusBadge status={status} />}
				</div>
				<Button variant="ghost" size="sm" onClick={onClose}>
					Close
				</Button>
			</div>

			{phase === "setup" ? (
				<SetupView
					isDestroy={isDestroy}
					connections={connections}
					loading={loadingConnections}
					selectedConnectionId={selectedConnectionId}
					onSelect={(id) => {
						setSelectedConnectionId(id);
						const connection = connections.find((item) => item._id === id);
						if (connection) setRegion(connection.region);
					}}
					region={region}
					onRegionChange={setRegion}
					starting={starting}
					onStart={() => void startDeployment()}
				/>
			) : (
				<>
					{isDestroy && (
						<div className="border-b bg-red-50 px-4 py-2 font-medium text-red-700 text-xs dark:bg-red-950 dark:text-red-400">
							Destruction mode — approved resources will be permanently removed.
						</div>
					)}

					{status !== "awaiting_approval" && CANCELLABLE.has(status) && (
						<div className="border-b px-4 py-3">
							<Button
								variant="outline"
								className="w-full"
								disabled={cancelling}
								onClick={() => void cancel()}
							>
								{cancelling ? "Cancelling..." : "Cancel deployment"}
							</Button>
						</div>
					)}

					{status === "awaiting_approval" && (
						<div className="border-b px-4 py-3">
							<p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
								Plan review
							</p>
							<ul className="mb-3 max-h-40 space-y-1 overflow-y-auto font-mono text-[11px]">
								{planResources.map((resource) => (
									<li
										key={resource.address}
										className={
											resource.action === "delete"
												? "text-red-600 dark:text-red-400"
												: "text-green-600 dark:text-green-400"
										}
									>
										{resource.action === "delete" ? "- " : "+ "}
										{resource.address}
									</li>
								))}
							</ul>
							<Button
								className={`w-full ${isDestroy ? "bg-red-600 text-white hover:bg-red-500" : ""}`}
								disabled={approving}
								onClick={() => void approve()}
							>
								{approving
									? "Approving..."
									: isDestroy
										? "Approve & destroy"
										: "Approve & apply"}
							</Button>
							<Button
								variant="outline"
								className="mt-2 w-full"
								disabled={cancelling}
								onClick={() => void cancel()}
							>
								{cancelling ? "Cancelling..." : "Cancel deployment"}
							</Button>
						</div>
					)}

					<div className="flex-1 space-y-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed">
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
				</>
			)}
		</div>
	);
}

function SetupView({
	isDestroy,
	connections,
	loading,
	selectedConnectionId,
	onSelect,
	region,
	onRegionChange,
	starting,
	onStart,
}: {
	isDestroy: boolean;
	connections: AwsConnectionDto[];
	loading: boolean;
	selectedConnectionId: string | null;
	onSelect: (id: string | null) => void;
	region: string;
	onRegionChange: (region: string) => void;
	starting: boolean;
	onStart: () => void;
}) {
	return (
		<div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
			{isDestroy && (
				<div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700 text-xs dark:border-red-900 dark:bg-red-950 dark:text-red-400">
					A destruction plan will be generated first. Nothing is removed until
					you review it and approve.
				</div>
			)}

			<div>
				<Label className="mb-2 block font-medium text-muted-foreground text-xs uppercase tracking-wide">
					AWS account
				</Label>
				{loading ? (
					<p className="text-muted-foreground text-sm">
						Loading connections...
					</p>
				) : (
					<div className="space-y-2">
						<button
							type="button"
							onClick={() => onSelect(null)}
							className={`w-full rounded-md border p-2.5 text-left text-sm ${
								selectedConnectionId === null
									? "border-primary ring-1 ring-primary"
									: "hover:bg-accent"
							}`}
						>
							Worker default credentials
							<span className="block text-[11px] text-muted-foreground">
								env-configured on the worker (dev only)
							</span>
						</button>
						{connections.map((connection) => (
							<button
								key={connection._id}
								type="button"
								onClick={() => onSelect(connection._id)}
								className={`w-full rounded-md border p-2.5 text-left text-sm ${
									selectedConnectionId === connection._id
										? "border-primary ring-1 ring-primary"
										: "hover:bg-accent"
								}`}
							>
								{connection.label}
								<span className="block truncate font-mono text-[11px] text-muted-foreground">
									{connection.region} · {connection.roleArn}
								</span>
							</button>
						))}
						{connections.length === 0 && (
							<a
								href="/settings/aws"
								className="block rounded-md border border-dashed p-2.5 text-center text-muted-foreground text-xs hover:text-foreground"
							>
								+ Register an IAM role connection in settings
							</a>
						)}
					</div>
				)}
			</div>

			<div>
				<Label className="mb-2 block font-medium text-muted-foreground text-xs uppercase tracking-wide">
					Region
				</Label>
				<input
					list="cloudman-aws-regions"
					className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
					value={region}
					onChange={(event) => onRegionChange(event.target.value)}
					aria-label="AWS region"
				/>
				<datalist id="cloudman-aws-regions">
					{AWS_REGIONS.map((awsRegion) => (
						<option key={awsRegion} value={awsRegion} />
					))}
				</datalist>
				<p className="mt-1 text-[11px] text-muted-foreground">
					Auto-fills from the selected connection; the worker uses it for the
					plan/apply runs.
				</p>
			</div>

			<Button
				variant={isDestroy ? "destructive" : "default"}
				disabled={starting || loading}
				onClick={onStart}
			>
				{starting
					? "Starting..."
					: isDestroy
						? "Generate destruction plan"
						: "Start deployment"}
			</Button>
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
