"use client";

import { Badge } from "@my-better-t-app/ui/components/badge";
import { Button } from "@my-better-t-app/ui/components/button";
import { cn } from "@my-better-t-app/ui/lib/utils";
import { History, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { GraphJson } from "@/lib/graph-types";

interface VersionSummary {
	_id: string;
	version: number;
	createdAt: string;
}

export function GraphVersions({
	projectId,
	onLoad,
	onClose,
}: {
	projectId: string;
	onLoad: (graph: GraphJson, version: number) => void;
	onClose: () => void;
}) {
	const [versions, setVersions] = useState<VersionSummary[] | null>(null);
	const [current, setCurrent] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const result = await api<{ versions: VersionSummary[] }>(
				`/api/projects/${projectId}/graphs`,
			);
			setVersions(result.versions);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to load versions",
			);
		}
	}, [projectId]);

	useEffect(() => {
		void load();
	}, [load]);

	async function handleSelect(version: VersionSummary) {
		setCurrent(version._id);
		try {
			const result = await api<{ graphVersion: GraphJson | null }>(
				`/api/projects/${projectId}/graphs/${version.version}`,
			);
			if (result.graphVersion) {
				onLoad(result.graphVersion, version.version);
				onClose();
			} else {
				toast.error("Graph version not found");
			}
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to load version",
			);
		} finally {
			setCurrent(null);
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
			<button
				type="button"
				aria-label="Close versions"
				className="absolute inset-0 cursor-default bg-black/50"
				onClick={onClose}
			/>
			<div className="relative z-10 flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-lg border bg-card shadow-2xl">
				<div className="flex items-center gap-3 border-b px-4 py-2">
					<History className="size-4 text-muted-foreground" />
					<span className="font-semibold text-sm">Graph versions</span>
					<Button
						variant="ghost"
						size="sm"
						className="ml-auto"
						onClick={onClose}
						aria-label="Close versions"
					>
						<X className="size-4" />
					</Button>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto p-2">
					{versions === null ? (
						<p className="p-3 text-muted-foreground text-sm">
							Loading versions...
						</p>
					) : versions.length === 0 ? (
						<p className="p-3 text-muted-foreground text-sm">
							No saved versions yet — use Save to snapshot the canvas.
						</p>
					) : (
						<ul className="divide-y">
							{versions.map((version) => (
								<li key={version._id}>
									<button
										type="button"
										disabled={current === version._id}
										onClick={() => void handleSelect(version)}
										className={cn(
											"flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-60",
										)}
									>
										<span className="flex items-center gap-2">
											<Badge variant="outline">v{version.version}</Badge>
											<span className="text-muted-foreground">
												{new Date(version.createdAt).toLocaleString()}
											</span>
										</span>
										<span className="text-muted-foreground text-xs">
											{current === version._id ? "Loading..." : "Load"}
										</span>
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	);
}
