"use client";

import { Badge } from "@my-better-t-app/ui/components/badge";
import { Button } from "@my-better-t-app/ui/components/button";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { api } from "@/lib/api";

interface HealthDto {
	ok: boolean;
	service?: string;
}

type HealthState = "loading" | "ok" | "down";

export function ApiStatus() {
	const [state, setState] = useState<HealthState>("loading");
	const [service, setService] = useState("");
	const [refreshKey, setRefreshKey] = useState(0);

	useEffect(() => {
		let cancelled = false;
		api<HealthDto>("/health")
			.then((result) => {
				if (cancelled) return;
				setState(result.ok ? "ok" : "down");
				setService(result.service ?? "");
			})
			.catch(() => {
				if (cancelled) return;
				setState("down");
				toast.error("API is unreachable");
			});
		return () => {
			cancelled = true;
		};
	}, [refreshKey]);

	const badge =
		state === "loading" ? (
			<Badge variant="secondary">Checking…</Badge>
		) : state === "ok" ? (
			<Badge variant="default">Online {service ? `(${service})` : ""}</Badge>
		) : (
			<Badge variant="destructive">Unreachable</Badge>
		);

	return (
		<div className="flex items-center justify-between rounded-lg border p-4">
			<div>
				<h2 className="mb-1 font-medium">API status</h2>
				<p className="text-muted-foreground text-sm">
					{state === "ok"
						? "The CloudMan API and database are responding."
						: state === "down"
							? "Could not reach the API. Start it with `bun run dev` at the repo root."
							: "Contacting the API..."}
				</p>
			</div>
			<div className="flex items-center gap-2">
				{badge}
				{state === "down" && (
					<Button
						variant="outline"
						size="sm"
						onClick={() => setRefreshKey((current) => current + 1)}
					>
						Retry
					</Button>
				)}
			</div>
		</div>
	);
}
