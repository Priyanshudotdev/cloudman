"use client";

import { Button, buttonVariants } from "@my-better-t-app/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@my-better-t-app/ui/components/card";
import { Input } from "@my-better-t-app/ui/components/input";
import { Label } from "@my-better-t-app/ui/components/label";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { AwsConnectionDto } from "@/lib/api";
import { ApiError, api } from "@/lib/api";

const EMPTY_FORM = {
	label: "",
	roleArn: "",
	externalId: "",
	region: "us-east-1",
};

export function AwsConnectionsManager() {
	const [connections, setConnections] = useState<AwsConnectionDto[]>([]);
	const [loading, setLoading] = useState(true);
	const [form, setForm] = useState(EMPTY_FORM);
	const [saving, setSaving] = useState(false);
	const [verifyingId, setVerifyingId] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const result = await api<{ connections: AwsConnectionDto[] }>(
				"/api/aws-connections",
			);
			setConnections(result.connections);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to load connections",
			);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function createConnection() {
		setSaving(true);
		try {
			await api("/api/aws-connections", {
				method: "POST",
				body: JSON.stringify(form),
			});
			setForm(EMPTY_FORM);
			toast.success("AWS connection added");
			await load();
		} catch (error) {
			if (error instanceof ApiError && error.issues) {
				toast.error(error.issues.map((issue) => issue.message).join("\n"));
			} else {
				toast.error(
					error instanceof Error ? error.message : "Failed to add connection",
				);
			}
		} finally {
			setSaving(false);
		}
	}

	async function deleteConnection(connection: AwsConnectionDto) {
		const confirmed = window.confirm(
			`Remove connection "${connection.label}"? Deployments won't be able to use it until you re-add it.`,
		);
		if (!confirmed) return;
		try {
			await api(`/api/aws-connections/${connection._id}`, { method: "DELETE" });
			setConnections((current) =>
				current.filter((item) => item._id !== connection._id),
			);
			toast.success("Connection removed");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to remove connection",
			);
		}
	}

	async function verifyConnection(id: string) {
		setVerifyingId(id);
		try {
			const result = await api<{
				ok: boolean;
				account?: string;
				arn?: string;
				error?: string;
			}>(`/api/aws-connections/${id}/verify`, { method: "POST" });
			toast.success(
				`Verified — account ${result.account ?? "?"} (${result.arn ?? "unknown identity"})`,
			);
		} catch (error) {
			if (error instanceof ApiError && error.message) {
				toast.error(`Verification failed: ${error.message}`);
			} else {
				toast.error(
					error instanceof Error
						? `Verification failed: ${error.message}`
						: "Verification failed",
				);
			}
		} finally {
			setVerifyingId(null);
		}
	}

	return (
		<div className="container mx-auto max-w-3xl px-4 py-8">
			<h1 className="mb-1 font-semibold text-xl">AWS connections</h1>
			<p className="mb-6 text-muted-foreground text-sm">
				Register an IAM role CloudMan may assume with STS. The worker never
				stores long-term keys — each deployment receives temporary credentials.
			</p>

			<Card className="mb-6">
				<CardHeader className="pb-2">
					<CardTitle className="text-base">Add connection</CardTitle>
					<CardDescription>
						In your AWS account create a role whose trust policy allows
						CloudMan's worker to assume it, restricted by the external ID you
						choose here.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-3">
					<div className="grid gap-1.5">
						<Label htmlFor="conn-label">Label</Label>
						<Input
							id="conn-label"
							placeholder="e.g. personal-dev-account"
							value={form.label}
							onChange={(event) =>
								setForm({ ...form, label: event.target.value })
							}
						/>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="conn-role">IAM role ARN</Label>
						<Input
							id="conn-role"
							className="font-mono text-xs"
							placeholder="arn:aws:iam::123456789012:role/CloudManDeployRole"
							value={form.roleArn}
							onChange={(event) =>
								setForm({ ...form, roleArn: event.target.value })
							}
						/>
					</div>
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="grid gap-1.5">
							<Label htmlFor="conn-ext">External ID</Label>
							<Input
								id="conn-ext"
								className="font-mono text-xs"
								placeholder="min 8 characters"
								value={form.externalId}
								onChange={(event) =>
									setForm({ ...form, externalId: event.target.value })
								}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="conn-region">Default region</Label>
							<Input
								id="conn-region"
								value={form.region}
								onChange={(event) =>
									setForm({ ...form, region: event.target.value })
								}
							/>
						</div>
					</div>
					<Button
						disabled={
							saving ||
							!form.label.trim() ||
							!form.roleArn.trim() ||
							form.externalId.length < 8
						}
						onClick={() => void createConnection()}
					>
						{saving ? "Saving..." : "Add connection"}
					</Button>
				</CardContent>
			</Card>

			{loading ? (
				<p className="text-muted-foreground text-sm">Loading connections...</p>
			) : connections.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No connections registered yet.
				</p>
			) : (
				<div className="grid gap-3">
					{connections.map((connection) => (
						<Card key={connection._id}>
							<CardContent className="flex items-center justify-between py-4">
								<div className="min-w-0">
									<p className="font-medium text-sm">{connection.label}</p>
									<p className="truncate font-mono text-[11px] text-muted-foreground">
										{connection.roleArn}
									</p>
									<p className="text-[11px] text-muted-foreground">
										region: {connection.region}
									</p>
								</div>
								<div className="flex shrink-0 items-center gap-2">
									<Button
										disabled={verifyingId !== null}
										size="sm"
										variant="outline"
										onClick={() => void verifyConnection(connection._id)}
									>
										{verifyingId === connection._id ? "Verifying..." : "Verify"}
									</Button>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => void deleteConnection(connection)}
									>
										Remove
									</Button>
								</div>
							</CardContent>
						</Card>
					))}
				</div>
			)}

			<div className="mt-6">
				<a
					href="/dashboard"
					className={buttonVariants({ variant: "link", size: "sm" })}
				>
					← Back to projects
				</a>
			</div>
		</div>
	);
}
