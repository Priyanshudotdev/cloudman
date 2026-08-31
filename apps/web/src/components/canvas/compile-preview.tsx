"use client";

import { Badge } from "@my-better-t-app/ui/components/badge";
import { Button } from "@my-better-t-app/ui/components/button";
import { cn } from "@my-better-t-app/ui/lib/utils";
import {
	AlertTriangle,
	Check,
	Copy,
	FileCode2,
	Receipt,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import type { CompileResultDto } from "@/lib/api";

const SEVERITY_STYLES: Record<string, string> = {
	high: "border-red-600/40 bg-red-600/10 text-red-400",
	medium: "border-amber-500/40 bg-amber-500/10 text-amber-400",
	low: "border-sky-500/40 bg-sky-500/10 text-sky-400",
};

function money(value: number): string {
	return `$${value.toFixed(2)}`;
}

export function CompilePreview({
	result,
	onClose,
}: {
	result: CompileResultDto;
	onClose: () => void;
}) {
	const [selectedPath, setSelectedPath] = useState(result.files[0]?.path ?? "");
	const [copied, setCopied] = useState(false);

	const selected = useMemo(
		() => result.files.find((file) => file.path === selectedPath) ?? null,
		[result.files, selectedPath],
	);

	const costRows = result.cost.resources.filter((row) => row.monthly > 0);
	const riskCount = result.risks.length;

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
			<div className="relative z-10 flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border bg-card shadow-2xl">
				<div className="flex items-center gap-3 border-b px-4 py-2">
					<FileCode2 className="size-4 text-muted-foreground" />
					<span className="font-semibold text-sm">Generated OpenTofu</span>
					<div className="ml-auto flex items-center gap-2">
						<Badge variant="secondary">
							{result.stats.resources} resources
						</Badge>
						<Badge variant="secondary">{result.stats.files} files</Badge>
						<Badge variant="outline">
							~{money(result.cost.monthlyTotal)}/mo
						</Badge>
						{riskCount > 0 && (
							<Badge
								variant="outline"
								className="border-amber-500/40 text-amber-400"
							>
								<AlertTriangle className="mr-1 size-3" />
								{riskCount} warning{riskCount === 1 ? "" : "s"}
							</Badge>
						)}
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
					<div className="w-64 shrink-0 space-y-4 overflow-y-auto border-r p-3 text-sm">
						<div className="space-y-1.5">
							<div className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
								Files
							</div>
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

						<div className="space-y-2">
							<div className="flex items-center gap-1.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
								<Receipt className="size-3" />
								Cost estimate
							</div>
							<p className="font-bold text-lg">
								~{money(result.cost.monthlyTotal)}
								<span className="font-normal text-muted-foreground text-xs">
									{" "}
									/mo
								</span>
							</p>
							{costRows.length === 0 ? (
								<p className="text-muted-foreground text-xs">
									No recurring charges from this stack.
								</p>
							) : (
								<ul className="space-y-1">
									{costRows.map((row) => (
										<li key={row.irId}>
											<div className="flex items-center justify-between gap-2">
												<span className="truncate text-xs" title={row.label}>
													{row.label}
												</span>
												<span className="shrink-0 font-medium text-xs">
													{money(row.monthly)}
												</span>
											</div>
										</li>
									))}
								</ul>
							)}
							<p className="text-[11px] text-muted-foreground leading-snug">
								Indicative us-east-1 pricing, not a quote.
							</p>
						</div>

						{riskCount > 0 && (
							<div className="space-y-2">
								<div className="flex items-center gap-1.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
									<AlertTriangle className="size-3" />
									Risk review
								</div>
								<ul className="space-y-1.5">
									{result.risks.map((risk) => (
										<li
											key={`${risk.irId}-${risk.code}`}
											className={cn(
												"rounded-md border px-2 py-1.5 text-xs",
												SEVERITY_STYLES[risk.severity] ?? SEVERITY_STYLES.low,
											)}
										>
											<span className="font-medium">{risk.label}: </span>
											{risk.message}
										</li>
									))}
								</ul>
							</div>
						)}
					</div>

					<div className="flex min-w-0 flex-1 flex-col">
						<div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
							<span className="truncate font-mono text-muted-foreground text-xs">
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
