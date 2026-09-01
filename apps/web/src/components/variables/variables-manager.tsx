"use client";

import { Button } from "@my-better-t-app/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@my-better-t-app/ui/components/card";
import { Input } from "@my-better-t-app/ui/components/input";
import { Label } from "@my-better-t-app/ui/components/label";
import { Plus, Trash2, Variable } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";

type Var = { id: string; key: string; value: string };

export function VariablesManager() {
	const [vars, setVars] = useState<Var[]>([]);
	const [key, setKey] = useState("");
	const [value, setValue] = useState("");

	useEffect(() => {
		try { const raw = localStorage.getItem("cm.vars"); if (raw) setVars(JSON.parse(raw) as Var[]); } catch {}
	}, []);

	function persist(next: Var[]) {
		setVars(next);
		try { localStorage.setItem("cm.vars", JSON.stringify(next)); } catch {}
	}
	function add() {
		if (!key.trim()) { toast.error("Key required"); return; }
		if (vars.some(v=>v.key===key.trim())) { toast.error("Key already exists"); return; }
		const next = [...vars, { id: Math.random().toString(36).slice(2), key: key.trim(), value }];
		persist(next); setKey(""); setValue(""); toast.success("Variable added");
	}
	function remove(id: string) { persist(vars.filter(v=>v.id!==id)); }

	return (
		<AppShell>
			<div className="flex h-12 shrink-0 items-center border-b bg-card px-4 sm:px-6">
				<h1 className="text-sm font-semibold text-foreground">Variables</h1>
				<span className="ml-2 hidden text-xs text-muted-foreground sm:inline">Reusable values for templates and canvas</span>
			</div>
			<div className="flex-1 overflow-y-auto">
				<div className="mx-auto max-w-3xl p-4 sm:p-6">
					<Card className="mb-6">
						<CardHeader><CardTitle className="text-sm">Add variable</CardTitle></CardHeader>
						<CardContent className="grid gap-3">
							<div className="grid gap-3 sm:grid-cols-2">
								<div className="grid gap-1.5"><Label>Key</Label><Input placeholder="ENV_NAME" value={key} onChange={e=>setKey(e.target.value)} /></div>
								<div className="grid gap-1.5"><Label>Value</Label><Input placeholder="value" value={value} onChange={e=>setValue(e.target.value)} /></div>
							</div>
							<Button onClick={add} className="w-fit bg-brand text-brand-foreground hover:bg-brand/90"><Plus className="mr-1 size-4" />Add</Button>
							<p className="text-xs text-muted-foreground">Stored locally in your browser (localStorage). Use to copy into canvas fields.</p>
						</CardContent>
					</Card>
					{vars.length===0 ? (
						<div className="rounded-lg border border-dashed bg-card p-10 text-center">
							<Variable className="mx-auto size-6 text-muted-foreground" />
							<p className="mt-2 text-sm font-medium text-foreground">No variables yet</p>
							<p className="text-xs text-muted-foreground">Add your first variable above.</p>
						</div>
					) : (
						<div className="grid gap-2">
							{vars.map(v=>(
								<div key={v.id} className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
									<div className="min-w-0"><p className="font-mono text-xs font-medium text-foreground">{v.key}</p><p className="truncate font-mono text-xs text-muted-foreground">{v.value || "—"}</p></div>
									<Button variant="ghost" size="sm" onClick={()=>remove(v.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></Button>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</AppShell>
	);
}
