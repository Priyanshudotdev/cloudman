"use client";

import { Badge } from "@my-better-t-app/ui/components/badge";
import { Button } from "@my-better-t-app/ui/components/button";
import { Check, Copy, FileCode2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@my-better-t-app/ui/lib/utils";

import type { CompileResultDto } from "@/lib/api";

export function CompilePreview({
	result,
	onClose,
}: {
	result: CompileResultDto;
	onClose: () => void;
}) {
	const [selectedPath, setSelectedPath] = useState(
		result.files[0]?.path ?? "",
	);
	const [copied, setCopied] = useState(false);

	const selected = useMemo(
		() => result.files.find((file) => file.path === selectedPath) ?? null,
		[result.files, selectedPath],
	);

	async function copySelected() {
		if (!selected) return;
		await navigator.clipboard.writeText(selected.contents);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
		toast.success(`Copied ${selected.path}`);
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
			<button
				type="button"
				aria-label="Close preview"
				className="absolute inset-0 cursor-default bg-black/50"
				onClick={onClose}
			/>
			<div className="relative z-10 flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border bg-card shadow-2xl">
				<div className="flex items-center gap-3 border-b px-4 py-2">
					<FileCode2 className="size-4 text-muted-foreground" />
					<span className="font-semibold text-sm">Generated OpenTofu</span>
					<div className="ml-auto flex items-center gap-2">
						<Badge variant="secondary">
							{result.stats.resources} resources
						</Badge>
						<Badge variant="secondary">{result.stats.files} files</Badge>
						<Badge variant="secondary">
							{(result.stats.bytes / 1024).toFixed(1)} kB
						</Badge>
						<Button
							variant="ghost"
							size="sm"
							onClick={onClose}
							aria-label="Close preview"
						>
							<X className="size-4" />
						</Button>
					</div>
				</div>

				<div className="flex min-h-0 flex-1">
					<div className="w-40 shrink-0 space-y-1 overflow-y-auto border-r p-2">
						{result.files.map((file) => (
							<button
								type="button"
								key={file.path}
								onClick={() => setSelectedPath(file.path)}
								className={cn(
									"block w-full truncate rounded-md px-2 py-1.5 text-left font-mono text-xs hover:bg-accent",
									file.path === selectedPath && "bg-accent",
								)}
							>
								{file.path}
							</button>
						))}
					</div>

					<div className="flex min-w-0 flex-1 flex-col">
						<div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
							<span className="truncate font-mono text-xs text-muted-foreground">
								{selected?.path ?? ""}
							</span>
							<Button
								variant="ghost"
								size="sm"
								disabled={!selected}
								onClick={() => void copySelected()}
							>
								{copied ? (
									<Check className="size-4 text-emerald-500" />
								) : (
									<Copy className="size-4" />
								)}
							</Button>
						</div>
						<pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
							{selected?.contents ?? "No file selected"}
						</pre>
					</div>
				</div>
			</div>
		</div>
	);
}