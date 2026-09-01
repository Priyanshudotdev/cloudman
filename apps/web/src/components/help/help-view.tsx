"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@my-better-t-app/ui/components/card";
import { BookOpen, ExternalLink, LifeBuoy, MessageCircle } from "lucide-react";

import { AppShell } from "@/components/app-shell";

export function HelpView() {
	return (
		<AppShell>
			<div className="flex h-12 shrink-0 items-center border-b bg-card px-4 sm:px-6">
				<h1 className="text-sm font-semibold text-foreground">Help</h1>
				<span className="ml-2 hidden text-xs text-muted-foreground sm:inline">Docs and support</span>
			</div>
			<div className="flex-1 overflow-y-auto">
				<div className="mx-auto max-w-3xl p-4 sm:p-6">
					<div className="grid gap-4">
						<Card>
							<CardHeader><CardTitle className="flex items-center gap-2 text-sm"><BookOpen className="size-4" />Quick start</CardTitle></CardHeader>
							<CardContent className="space-y-2 text-sm text-muted-foreground">
								<ol className="list-decimal space-y-1 pl-5">
									<li>Create a project from <span className="font-medium text-foreground">Overview</span> or pick a <span className="font-medium text-foreground">Template</span>.</li>
									<li>Drag resources onto the canvas and wire dependencies.</li>
									<li><span className="font-medium text-foreground">Validate</span> to preview OpenTofu, cost and risks, then <span className="font-medium text-foreground">Deploy</span> with human approval.</li>
								</ol>
							</CardContent>
						</Card>
						<Card>
							<CardHeader><CardTitle className="flex items-center gap-2 text-sm"><LifeBuoy className="size-4" />Resources</CardTitle></CardHeader>
							<CardContent className="grid gap-2 text-sm">
								<a href="/dashboard" className="flex items-center justify-between rounded-md border bg-card px-3 py-2 hover:bg-muted">Overview <ExternalLink className="size-3.5 text-muted-foreground" /></a>
								<a href="/settings/aws" className="flex items-center justify-between rounded-md border bg-card px-3 py-2 hover:bg-muted">AWS connections <ExternalLink className="size-3.5 text-muted-foreground" /></a>
								<a href="/templates" className="flex items-center justify-between rounded-md border bg-card px-3 py-2 hover:bg-muted">Templates <ExternalLink className="size-3.5 text-muted-foreground" /></a>
							</CardContent>
						</Card>
						<Card>
							<CardHeader><CardTitle className="flex items-center gap-2 text-sm"><MessageCircle className="size-4" />Need help?</CardTitle></CardHeader>
							<CardContent className="text-sm text-muted-foreground">
								Check canvas validation issues, or open an issue at <span className="font-mono text-xs text-foreground">github.com/rolexdotdev/cloudman</span>.
							</CardContent>
						</Card>
					</div>
				</div>
			</div>
		</AppShell>
	);
}
