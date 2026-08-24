import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildIR, compileIR } from "@my-better-t-app/core";
import {
	AwsConnection,
	Deployment,
	GraphVersion,
	resolveExternalId,
} from "@my-better-t-app/db";
import { env } from "@my-better-t-app/env/worker";
import type { InfraPlanJobData } from "@my-better-t-app/queue";
import type { Job } from "bullmq";
import { resolveAwsCredentials } from "../lib/aws";
import { recordDeploymentEvent, sleep, tail } from "../lib/events";
import {
	backendTfContents,
	createStateClient,
	ensureStateBucket,
	stateBucketName,
} from "../lib/state-backend";
import { runTofu, type TofuRunResult } from "../lib/tofu";
import { prepareWorkspace } from "../lib/workspace";

interface TofuPlanJson {
	resource_changes?: Array<{
		address: string;
		change?: { actions?: string[] };
	}>;
}

export interface PlanSummaryData {
	create: number;
	update: number;
	destroy: number;
	resources: Array<{ address: string; action: string; name?: string }>;
}

function summarizePlan(json: TofuPlanJson): PlanSummaryData {
	const summary: PlanSummaryData = {
		create: 0,
		update: 0,
		destroy: 0,
		resources: [],
	};
	for (const change of json.resource_changes ?? []) {
		const actions = change.change?.actions ?? [];
		const primary =
			actions.includes("delete") && actions.includes("create")
				? "replace"
				: (actions[0] ?? "no-op");
		if (primary === "create") summary.create += 1;
		else if (primary === "update" || primary === "replace") summary.update += 1;
		else if (primary === "delete") summary.destroy += 1;
		if (summary.resources.length < 100) {
			summary.resources.push({ address: change.address, action: primary });
		}
	}
	return summary;
}

function awsEnv(
	creds: {
		accessKeyId: string;
		secretAccessKey: string;
		sessionToken?: string;
	},
	region: string,
) {
	return {
		AWS_ACCESS_KEY_ID: creds.accessKeyId,
		AWS_SECRET_ACCESS_KEY: creds.secretAccessKey,
		...(creds.sessionToken ? { AWS_SESSION_TOKEN: creds.sessionToken } : {}),
		AWS_REGION: region,
		AWS_DEFAULT_REGION: region,
	};
}

async function mockSummary(
	document: { resources: Array<{ kind: string; name: string }> },
	isDestroy: boolean,
): Promise<PlanSummaryData> {
	await sleep(900);
	const resources = document.resources.map((resource) => ({
		address: `${resource.kind}.${resource.name}`,
		action: isDestroy ? "delete" : "create",
	}));
	return {
		create: isDestroy ? 0 : resources.length,
		update: 0,
		destroy: isDestroy ? resources.length : 0,
		resources,
	};
}

export async function handlePlanJob(job: Job<InfraPlanJobData>): Promise<void> {
	const { deploymentId } = job.data;

	const deployment = await Deployment.findById(deploymentId).lean();
	if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);
	if (deployment.status !== "queued") {
		console.log(`[worker] plan job skipped — status is "${deployment.status}"`);
		return;
	}

	const graphVersion = await GraphVersion.findById(
		deployment.graphVersionId,
	).lean();
	if (!graphVersion?.graph)
		throw new Error(`Graph version missing for deployment ${deploymentId}`);

	let connection: { roleArn: string; externalId: string } | null = null;
	if (deployment.awsConnectionId) {
		const conn = await AwsConnection.findById(
			deployment.awsConnectionId,
		).lean();
		if (conn)
			connection = {
				roleArn: conn.roleArn,
				externalId: resolveExternalId(conn.externalId, env.CLOUDMAN_SECRET),
			};
	}

	const region = deployment.region ?? env.AWS_REGION;
	const graph = graphVersion.graph as unknown;
	const isDestroy = deployment.action === "destroy";
	const projectId = String(deployment.projectId);

	try {
		await recordDeploymentEvent(
			deploymentId,
			{
				level: isDestroy ? "error" : "info",
				message: isDestroy
					? "DESTRUCTION RUN — validating current infrastructure graph..."
					: "Validating infrastructure graph...",
			},
			"initializing",
		);

		const built = buildIR(graph, { region });
		if (!built.ok) {
			throw new Error(
				`Graph validation failed: ${built.issues.map((i) => i.message).join("; ")}`,
			);
		}
		await recordDeploymentEvent(deploymentId, {
			level: "info",
			message: `Graph valid — ${built.document.resources.length} resource(s)`,
		});

		const files = compileIR(built.document, {
			bucketNameSuffix: projectId.slice(-8),
		});
		const cwd = await prepareWorkspace(projectId, files);
		await recordDeploymentEvent(deploymentId, {
			level: "info",
			message: `OpenTofu workspace prepared (${files.length} files)`,
		});

		let summary: PlanSummaryData;

		if (env.CLOUDMAN_WORKER_MOCK === "1") {
			if (env.CLOUDMAN_REMOTE_STATE === "1" && !isDestroy) {
				await recordDeploymentEvent(deploymentId, {
					level: "info",
					message: `Remote state backend simulated: s3://${stateBucketName(projectId)} (mock mode)`,
				});
			}
			await recordDeploymentEvent(deploymentId, {
				level: "progress",
				message: "Simulating tofu init (mock mode)...",
			});
			await sleep(800);
			await recordDeploymentEvent(
				deploymentId,
				{
					level: "progress",
					message: isDestroy
						? "Simulating tofu plan -destroy (mock mode)..."
						: "Simulating tofu plan (mock mode)...",
				},
				"planning",
			);
			summary = await mockSummary(built.document, isDestroy);
		} else {
			const binary = await resolveBinary();
			const creds = await resolveAwsCredentials(connection, deploymentId);
			await recordDeploymentEvent(deploymentId, {
				level: "info",
				message: `AWS credentials resolved via ${creds.source}`,
			});

			if (env.CLOUDMAN_REMOTE_STATE === "1") {
				const bucket = stateBucketName(projectId);
				const s3 = createStateClient(creds, region);
				const bucketState = await ensureStateBucket(s3, bucket, region);
				await recordDeploymentEvent(deploymentId, {
					level: "info",
					message: `Remote state backend: s3://${bucket} (${bucketState})`,
				});
				await writeFile(
					join(cwd, "backend.tf"),
					backendTfContents(bucket, region, projectId),
					"utf8",
				);
			}

			await recordDeploymentEvent(
				deploymentId,
				{ level: "progress", message: "Running tofu init..." },
				"initializing",
			);
			const extraEnv = awsEnv(creds, region);
			const init = await runTofu(
				binary,
				["init", "-input=false", "-no-color"],
				{
					cwd,
					env: extraEnv,
					timeoutMs: 15 * 60 * 1000,
				},
			);
			throwOnFailure(init, "tofu init");

			await recordDeploymentEvent(deploymentId, {
				level: "progress",
				message: "Running tofu validate...",
			});
			const validate = await runTofu(binary, ["validate", "-no-color"], {
				cwd,
				env: extraEnv,
				timeoutMs: 2 * 60 * 1000,
			});
			throwOnFailure(validate, "tofu validate");

			await recordDeploymentEvent(
				deploymentId,
				{
					level: "progress",
					message: isDestroy
						? "Planning infrastructure destruction (-destroy)..."
						: "Planning infrastructure changes...",
				},
				"planning",
			);
			const plan = await runTofu(
				binary,
				[
					"plan",
					"-input=false",
					"-no-color",
					"-out=tfplan.bin",
					...(isDestroy ? ["-destroy"] : []),
				],
				{
					cwd,
					env: extraEnv,
					timeoutMs: 10 * 60 * 1000,
					onLine: (line) => {
						if (/^(Plan:|Error:|Warning:)/.test(line.trim())) {
							void recordDeploymentEvent(deploymentId, {
								level: "info",
								message: line.trim(),
							});
						}
					},
				},
			);
			throwOnFailure(plan, "tofu plan");

			const show = await runTofu(binary, ["show", "-json", "tfplan.bin"], {
				cwd,
				env: extraEnv,
				timeoutMs: 2 * 60 * 1000,
			});
			if (show.code !== 0)
				throw new Error(`tofu show failed:\n${tail(show.output)}`);

			summary = summarizePlan(JSON.parse(show.output) as TofuPlanJson);
		}

		const fresh = await Deployment.findById(deploymentId)
			.select("status")
			.lean();
		if (fresh?.status === "canceled") {
			console.log("[worker] plan job aborted — deployment was canceled");
			return;
		}

		await Deployment.updateOne(
			{ _id: deploymentId },
			{
				$set: {
					planSummary: summary,
					status: "awaiting_approval",
					updatedAt: new Date(),
				},
			},
		);

		await recordDeploymentEvent(
			deploymentId,
			{
				level: "success",
				message: isDestroy
					? `Destruction plan ready — ${summary.destroy} resource(s) will be DESTROYED. Awaiting approval.`
					: `Plan ready — ${summary.create} to create, ${summary.update} to update, ${summary.destroy} to destroy. Awaiting approval.`,
				data: summary.resources,
			},
			"awaiting_approval",
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await recordDeploymentEvent(
			deploymentId,
			{ level: "error", message: `Deployment failed: ${message}` },
			"failed",
		);
		throw error;
	}
}

let cachedBinary: string | null = null;

async function resolveBinary(): Promise<string> {
	if (cachedBinary) return cachedBinary;
	const { resolveTofuBinary } = await import("../lib/tofu");
	cachedBinary = await resolveTofuBinary();
	return cachedBinary;
}

function throwOnFailure(result: TofuRunResult, step: string): void {
	if (result.code !== 0) {
		throw new Error(
			`${step} failed with exit code ${result.code}:\n${tail(result.output)}`,
		);
	}
}
