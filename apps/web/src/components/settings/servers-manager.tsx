"use client";

import { Badge } from "@my-better-t-app/ui/components/badge";
import { Button } from "@my-better-t-app/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@my-better-t-app/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@my-better-t-app/ui/components/empty";
import { Input } from "@my-better-t-app/ui/components/input";
import { Label } from "@my-better-t-app/ui/components/label";
import { Skeleton } from "@my-better-t-app/ui/components/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@my-better-t-app/ui/components/table";
import { Server } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ApiError } from "@/lib/api";
import {
	createServer,
	deleteServer,
	listServers,
	type ServerAuthMode,
	type ServerDto,
	updateServer,
	verifyServer,
} from "@/lib/servers-api";

const EMPTY_FORM = {
	label: "",
	host: "",
	port: "22",
	sshUser: "root",
	authMode: "key" as ServerAuthMode,
	credential: "",
	remoteAppDir: "/srv/cloudman",
};

function toEditForm(server: ServerDto) {
	return {
		label: server.label,
		host: server.host,
		port: String(server.port),
		sshUser: server.sshUser,
		authMode: server.authMode,
		credential: "",
		remoteAppDir: server.remoteAppDir,
	};
}

export function ServersManager() {
	const [servers, setServers] = useState<ServerDto[]>([]);
	const [loading, setLoading] = useState(true);
	const [form, setForm] = useState(EMPTY_FORM);
	const [saving, setSaving] = useState(false);
	const [verifyingId, setVerifyingId] = useState<string | null>(null);
	const [probeInfo, setProbeInfo] = useState<Record<string, string>>({});
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editForm, setEditForm] = useState({ ...EMPTY_FORM });
	const [editSaving, setEditSaving] = useState(false);

	const load = useCallback(async () => {
		try {
			setServers(await listServers());
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to load servers",
			);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function create() {
		setSaving(true);
		try {
			await createServer({
				label: form.label.trim(),
				host: form.host.trim(),
				port: Number(form.port) || 22,
				sshUser: form.sshUser.trim() || "root",
				authMode: form.authMode,
				credential: form.credential,
				remoteAppDir: form.remoteAppDir.trim() || "/srv/cloudman",
			});
			setForm(EMPTY_FORM);
			toast.success("Server added");
			await load();
		} catch (error) {
			if (error instanceof ApiError && error.issues) {
				toast.error(error.issues.map((issue) => issue.message).join("\n"));
			} else {
				toast.error(
					error instanceof Error ? error.message : "Failed to add server",
				);
			}
		} finally {
			setSaving(false);
		}
	}

	async function saveEdit(server: ServerDto) {
		setEditSaving(true);
		try {
			await updateServer(server._id, {
				label: editForm.label.trim(),
				host: editForm.host.trim(),
				port: Number(editForm.port) || server.port,
				sshUser: editForm.sshUser.trim(),
				authMode: editForm.authMode,
				...(editForm.credential ? { credential: editForm.credential } : {}),
				remoteAppDir: editForm.remoteAppDir.trim(),
			});
			setEditingId(null);
			toast.success("Server updated");
			await load();
		} catch (error) {
			if (error instanceof ApiError && error.issues) {
				toast.error(error.issues.map((issue) => issue.message).join("\n"));
			} else {
				toast.error(
					error instanceof Error ? error.message : "Failed to update server",
				);
			}
		} finally {
			setEditSaving(false);
		}
	}

	async function remove(server: ServerDto) {
		const confirmed = window.confirm(
			`Remove server "${server.label}"? Repo deployments targeting it will fail until you re-add it.`,
		);
		if (!confirmed) return;
		try {
			await deleteServer(server._id);
			setServers((current) =>
				current.filter((item) => item._id !== server._id),
			);
			toast.success("Server removed");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to remove server",
			);
		}
	}

	async function verify(server: ServerDto) {
		setVerifyingId(server._id);
		try {
			const result = await verifyServer(server._id);
			const who = `${result.user ?? "?"}@${result.hostname ?? "?"}`;
			setProbeInfo((current) => ({ ...current, [server._id]: who }));
			toast.success(
				`Verified — ${who}${result.fingerprint ? `\nFingerprint: ${result.fingerprint}` : ""}`,
			);
			await load();
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
		<AppShell>
			<div className="flex h-12 shrink-0 items-center border-b bg-card px-4 sm:px-6">
				<h1 className="font-semibold text-foreground text-sm">Servers</h1>
				<span className="ml-2 hidden text-muted-foreground text-xs sm:inline">
					Register SSH hosts CloudMan can deploy repos to
				</span>
			</div>
			<div className="flex-1 overflow-y-auto">
				<div className="mx-auto max-w-5xl p-4 sm:p-6">
					<p className="mb-6 text-muted-foreground text-sm">
						Credentials are encrypted at rest — verification only runs
						whoami/hostname over SSH and writes nothing.
					</p>

					<Card className="mb-6">
						<CardHeader className="pb-2">
							<CardTitle className="text-base">Add server</CardTitle>
							<CardDescription>
								A reachable host with an SSH user CloudMan may log in as. Paste
								a PEM private key or a password as the credential.
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-3">
							<div className="grid gap-1.5">
								<Label htmlFor="srv-label">Label</Label>
								<Input
									id="srv-label"
									placeholder="e.g. prod-vps-01"
									value={form.label}
									onChange={(event) =>
										setForm({ ...form, label: event.target.value })
									}
								/>
							</div>
							<div className="grid gap-3 sm:grid-cols-[1fr_120px]">
								<div className="grid gap-1.5">
									<Label htmlFor="srv-host">Host</Label>
									<Input
										id="srv-host"
										className="font-mono text-xs"
										placeholder="example.com or 203.0.113.10"
										value={form.host}
										onChange={(event) =>
											setForm({ ...form, host: event.target.value })
										}
									/>
								</div>
								<div className="grid gap-1.5">
									<Label htmlFor="srv-port">Port</Label>
									<Input
										id="srv-port"
										type="number"
										min={1}
										max={65535}
										value={form.port}
										onChange={(event) =>
											setForm({ ...form, port: event.target.value })
										}
									/>
								</div>
							</div>
							<div className="grid gap-3 sm:grid-cols-2">
								<div className="grid gap-1.5">
									<Label htmlFor="srv-user">SSH user</Label>
									<Input
										id="srv-user"
										placeholder="root"
										value={form.sshUser}
										onChange={(event) =>
											setForm({ ...form, sshUser: event.target.value })
										}
									/>
								</div>
								<div className="grid gap-1.5">
									<Label htmlFor="srv-auth">Auth mode</Label>
									<select
										id="srv-auth"
										className="h-9 rounded-md border bg-background px-3 text-sm"
										value={form.authMode}
										onChange={(event) =>
											setForm({
												...form,
												authMode: event.target.value as ServerAuthMode,
											})
										}
									>
										<option value="key">Private key</option>
										<option value="password">Password</option>
									</select>
								</div>
							</div>
							<div className="grid gap-1.5">
								<Label htmlFor="srv-cred">
									{form.authMode === "key" ? "Private key (PEM)" : "Password"}
								</Label>
								<Input
									id="srv-cred"
									type={form.authMode === "key" ? "text" : "password"}
									className="font-mono text-xs"
									placeholder={
										form.authMode === "key"
											? "-----BEGIN OPENSSH PRIVATE KEY-----"
											: "••••••••"
									}
									value={form.credential}
									onChange={(event) =>
										setForm({ ...form, credential: event.target.value })
									}
								/>
							</div>
							<div className="grid gap-1.5">
								<Label htmlFor="srv-dir">Remote app directory</Label>
								<Input
									id="srv-dir"
									className="font-mono text-xs"
									placeholder="/srv/cloudman"
									value={form.remoteAppDir}
									onChange={(event) =>
										setForm({ ...form, remoteAppDir: event.target.value })
									}
								/>
							</div>
							<Button
								disabled={
									saving ||
									!form.label.trim() ||
									!form.host.trim() ||
									!form.credential
								}
								onClick={() => void create()}
							>
								{saving ? "Saving..." : "Add server"}
							</Button>
						</CardContent>
					</Card>

					{loading ? (
						<div className="space-y-3">
							{Array.from({ length: 2 }).map((_, index) => (
								<Skeleton key={index} className="h-16 rounded-md" />
							))}
						</div>
					) : servers.length === 0 ? (
						<Empty className="border">
							<EmptyMedia variant="icon">
								<Server className="size-5" />
							</EmptyMedia>
							<EmptyHeader>
								<EmptyTitle>No servers registered</EmptyTitle>
								<EmptyDescription>
									Add an SSH host above to use it as a repo deployment target.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<div className="rounded-lg border bg-card">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Label</TableHead>
										<TableHead>Host</TableHead>
										<TableHead>SSH user</TableHead>
										<TableHead>Status</TableHead>
										<TableHead className="w-52">
											<span className="sr-only">Actions</span>
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{servers.map((server) =>
										editingId === server._id ? (
											<TableRow key={server._id}>
												<TableCell colSpan={5}>
													<div className="grid gap-3 py-2">
														<div className="grid gap-3 sm:grid-cols-2">
															<div className="grid gap-1.5">
																<Label htmlFor={`edit-label-${server._id}`}>
																	Label
																</Label>
																<Input
																	id={`edit-label-${server._id}`}
																	value={editForm.label}
																	onChange={(event) =>
																		setEditForm({
																			...editForm,
																			label: event.target.value,
																		})
																	}
																/>
															</div>
															<div className="grid grid-cols-[1fr_110px] gap-3">
																<div className="grid gap-1.5">
																	<Label htmlFor={`edit-host-${server._id}`}>
																		Host
																	</Label>
																	<Input
																		id={`edit-host-${server._id}`}
																		className="font-mono text-xs"
																		value={editForm.host}
																		onChange={(event) =>
																			setEditForm({
																				...editForm,
																				host: event.target.value,
																			})
																		}
																	/>
																</div>
																<div className="grid gap-1.5">
																	<Label htmlFor={`edit-port-${server._id}`}>
																		Port
																	</Label>
																	<Input
																		id={`edit-port-${server._id}`}
																		type="number"
																		min={1}
																		max={65535}
																		value={editForm.port}
																		onChange={(event) =>
																			setEditForm({
																				...editForm,
																				port: event.target.value,
																			})
																		}
																	/>
																</div>
															</div>
														</div>
														<div className="grid gap-3 sm:grid-cols-2">
															<div className="grid gap-1.5">
																<Label htmlFor={`edit-user-${server._id}`}>
																	SSH user
																</Label>
																<Input
																	id={`edit-user-${server._id}`}
																	value={editForm.sshUser}
																	onChange={(event) =>
																		setEditForm({
																			...editForm,
																			sshUser: event.target.value,
																		})
																	}
																/>
															</div>
															<div className="grid gap-1.5">
																<Label htmlFor={`edit-auth-${server._id}`}>
																	Auth mode
																</Label>
																<select
																	id={`edit-auth-${server._id}`}
																	className="h-9 rounded-md border bg-background px-3 text-sm"
																	value={editForm.authMode}
																	onChange={(event) =>
																		setEditForm({
																			...editForm,
																			authMode: event.target
																				.value as ServerAuthMode,
																		})
																	}
																>
																	<option value="key">Private key</option>
																	<option value="password">Password</option>
																</select>
															</div>
														</div>
														<div className="grid gap-3 sm:grid-cols-2">
															<div className="grid gap-1.5">
																<Label htmlFor={`edit-cred-${server._id}`}>
																	Rotate credential (blank keeps current)
																</Label>
																<Input
																	id={`edit-cred-${server._id}`}
																	type="password"
																	className="font-mono text-xs"
																	placeholder="Leave blank to keep"
																	value={editForm.credential}
																	onChange={(event) =>
																		setEditForm({
																			...editForm,
																			credential: event.target.value,
																		})
																	}
																/>
															</div>
															<div className="grid gap-1.5">
																<Label htmlFor={`edit-dir-${server._id}`}>
																	Remote app directory
																</Label>
																<Input
																	id={`edit-dir-${server._id}`}
																	className="font-mono text-xs"
																	value={editForm.remoteAppDir}
																	onChange={(event) =>
																		setEditForm({
																			...editForm,
																			remoteAppDir: event.target.value,
																		})
																	}
																/>
															</div>
														</div>
														<div className="flex items-center gap-1.5">
															<Button
																size="sm"
																disabled={editSaving}
																onClick={() => void saveEdit(server)}
															>
																{editSaving ? "Saving..." : "Save"}
															</Button>
															<Button
																variant="ghost"
																size="sm"
																disabled={editSaving}
																onClick={() => setEditingId(null)}
															>
																Cancel
															</Button>
														</div>
													</div>
												</TableCell>
											</TableRow>
										) : (
											<TableRow key={server._id}>
												<TableCell className="font-medium">
													{server.label}
												</TableCell>
												<TableCell className="font-mono text-muted-foreground text-xs">
													{server.host}:{server.port}
												</TableCell>
												<TableCell className="text-muted-foreground">
													{server.sshUser}
												</TableCell>
												<TableCell>
													<div className="flex flex-col gap-1">
														{server.verifiedAt ? (
															<Badge variant="default">Verified</Badge>
														) : (
															<Badge variant="secondary">Unverified</Badge>
														)}
														{server.hostKeyFingerprint && (
															<span className="max-w-[220px] truncate font-mono text-[11px] text-muted-foreground">
																{server.hostKeyFingerprint}
															</span>
														)}
														{probeInfo[server._id] && (
															<span className="font-mono text-[11px] text-muted-foreground">
																{probeInfo[server._id]}
															</span>
														)}
													</div>
												</TableCell>
												<TableCell>
													<div className="flex items-center gap-1.5">
														<Button
															disabled={verifyingId !== null}
															size="sm"
															variant="outline"
															onClick={() => void verify(server)}
														>
															{verifyingId === server._id
																? "Verifying..."
																: "Verify"}
														</Button>
														<Button
															variant="ghost"
															size="sm"
															onClick={() => {
																setEditForm(toEditForm(server));
																setEditingId(server._id);
															}}
														>
															Edit
														</Button>
														<Button
															variant="ghost"
															size="sm"
															onClick={() => void remove(server)}
														>
															Remove
														</Button>
													</div>
												</TableCell>
											</TableRow>
										),
									)}
								</TableBody>
							</Table>
						</div>
					)}
				</div>
			</div>
		</AppShell>
	);
}
