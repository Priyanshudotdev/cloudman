"use client";

import { Button } from "@my-better-t-app/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@my-better-t-app/ui/components/card";
import { Input } from "@my-better-t-app/ui/components/input";
import { Skeleton } from "@my-better-t-app/ui/components/skeleton";
import { Boxes, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ApiError, api, type BlueprintDto, type ProjectDto } from "@/lib/api";

export function TemplatesManager() {
	const [templates, setTemplates] = useState<BlueprintDto[]>([]);
	const [loading, setLoading] = useState(true);
	const [query, setQuery] = useState("");
	const [name, setName] = useState("");
	const [creating, setCreating] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const r = await api<{ blueprints: BlueprintDto[] }>("/api/blueprints");
			setTemplates(r.blueprints);
		} catch {
			toast.error("Failed to load templates");
		} finally {
			setLoading(false);
		}
	}, []);
	useEffect(() => { void load(); }, [load]);

	async function useTemplate(t: BlueprintDto) {
		if (!name.trim()) { toast.error("Enter a project name first"); return; }
		setCreating(t.id);
		try {
			const r = await api<{ project: ProjectDto }>("/api/projects", { method: "POST", body: JSON.stringify({ name: name.trim(), blueprint: t.id }) });
			toast.success(`Created from ${t.name}`);
			window.location.href = `/projects/${r.project._id}`;
		} catch (e) {
			if (e instanceof ApiError && e.issues) toast.error(e.issues.map(i=>i.message).join("\n"));
			else toast.error(e instanceof Error ? e.message : "Failed");
		} finally { setCreating(null); }
	}

	const filtered = templates.filter(t => !query.trim() || t.name.toLowerCase().includes(query.toLowerCase()) || t.description.toLowerCase().includes(query.toLowerCase()) || t.tags.some(tag=>tag.toLowerCase().includes(query.toLowerCase())));

	return (
		<AppShell>
			<div className="flex h-12 shrink-0 items-center gap-3 border-b bg-card px-4 sm:px-6">
				<h1 className="text-sm font-semibold text-foreground">Templates</h1>
				<span className="hidden text-xs text-muted-foreground sm:inline">Browse and launch pre-built stacks</span>
				<div className="ml-auto flex items-center gap-2">
					<div className="relative hidden sm:block">
						<Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input placeholder="Search templates" value={query} onChange={e=>setQuery(e.target.value)} className="h-8 w-56 bg-muted pl-8 text-xs" />
					</div>
					<Input placeholder="New project name" value={name} onChange={e=>setName(e.target.value)} className="h-8 w-40 text-xs" />
				</div>
			</div>
			<div className="flex-1 overflow-y-auto">
				<div className="mx-auto max-w-6xl p-4 sm:p-6">
					<div className="mb-4 flex items-center gap-2 sm:hidden">
						<div className="relative flex-1">
							<Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input placeholder="Search templates" value={query} onChange={e=>setQuery(e.target.value)} className="h-8 bg-muted pl-8 text-xs" />
						</div>
					</div>
					{loading ? (
						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{Array.from({length:6}).map((_,i)=><Skeleton key={i} className="h-40 rounded-lg" />)}
						</div>
					) : filtered.length===0 ? (
						<div className="rounded-lg border border-dashed bg-card p-12 text-center">
							<Boxes className="mx-auto size-6 text-muted-foreground" />
							<p className="mt-3 text-sm font-medium text-foreground">No templates found</p>
							<p className="text-xs text-muted-foreground">Try a different search.</p>
						</div>
					) : (
						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{filtered.map(t=>(
								<Card key={t.id} className="flex flex-col border bg-card hover:border-border">
									<CardHeader className="pb-2">
										<div className="flex items-center gap-2">
											<span className="flex size-7 items-center justify-center rounded bg-muted text-muted-foreground"><Boxes className="size-4" /></span>
											<CardTitle className="text-sm text-foreground">{t.name}</CardTitle>
										</div>
										<CardDescription className="line-clamp-3 text-xs">{t.description}</CardDescription>
									</CardHeader>
									<CardContent className="mt-auto flex flex-col gap-3">
										<div className="flex flex-wrap gap-1">
											{t.tags.slice(0,4).map(tag=><span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{tag}</span>)}
										</div>
										<Button size="sm" disabled={!name.trim() || creating===t.id} onClick={()=>void useTemplate(t)} className="w-full bg-brand text-brand-foreground hover:bg-brand/90">
											{creating===t.id ? "Creating…" : "Use template"}
										</Button>
									</CardContent>
								</Card>
							))}
						</div>
					)}
					<div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
						<Sparkles className="size-3.5" /> Templates are versioned OpenTofu stacks — you can edit on canvas after creation.
					</div>
				</div>
			</div>
		</AppShell>
	);
}
