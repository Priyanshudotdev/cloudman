import { buildIR, compileIR } from "@my-better-t-app/core";
import { AwsConnection, Deployment, GraphVersion } from "@my-better-t-app/db";
import { env } from "@my-better-t-app/env/worker";
import type { InfraPlanJobData } from "@my-better-t-app/queue";
import type { Job } from "bullmq";
import { resolveAwsCredentials } from "../lib/aws";
import { recordDeploymentEvent, sleep, tail } from "../lib/events";
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

async function mockPlan(): Promise<PlanSummaryData> {
	await sleep(900);
	return {
		create: 2,
		update: 0,
		destroy: 0,
		resources: [
			{ address: "aws_s3_bucket.assets", action: "create", name: "assets" },
			{ address: "aws_instance.app", action: "create", name: "app" },
		],
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
			connection = { roleArn: conn.roleArn, externalId: conn.externalId };
	}

	const region = deployment.region ?? env.AWS_REGION;
	const graph = graphVersion.graph as unknown;

	try {
		await recordDeploymentEvent(
			deploymentId,
			{ level: "info", message: "Validating infrastructure graph..." },
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
			bucketNameSuffix: deploymentId.slice(-8),
		});
		const cwd = await prepareWorkspace(deploymentId, files);
		await recordDeploymentEvent(deploymentId, {
			level: "info",
			message: `OpenTofu workspace prepared (${files.length} files)`,
		});

		let summary: PlanSummaryData;

		if (env.CLOUDMAN_WORKER_MOCK === "1") {
			await recordDeploymentEvent(deploymentId, {
				level: "progress",
				message: "Simulating tofu init (mock mode)...",
			});
			await sleep(800);
			await recordDeploymentEvent(
				deploymentId,
				{ level: "progress", message: "Simulating tofu plan (mock mode)..." },
				"planning",
			);
			summary = await mockPlan();
		} else {
			const binary = await resolveBinary();
			const creds = await resolveAwsCredentials(connection, deploymentId);
			await recordDeploymentEvent(deploymentId, {
				level: "info",
				message: `AWS credentials resolved via ${creds.source}`,
			});

			await recordDeploymentEvent(
				deploymentId,
				{ level: "progress", message: "Running tofu init..." },
				"initializing",
			);
			const extraEnv = awsEnv(creds, region);
			const init = await runTofu(
				binary,
				["init", "-input=false", "-no-color"],
				{ cwd, env: extraEnv },
			);
			throwOnFailure(init, "tofu init");

			await recordDeploymentEvent(deploymentId, {
				level: "progress",
				message: "Running tofu validate...",
			});
			const validate = await runTofu(binary, ["validate", "-no-color"], {
				cwd,
				env: extraEnv,
			});
			throwOnFailure(validate, "tofu validate");

			await recordDeploymentEvent(
				deploymentId,
				{ level: "progress", message: "Planning infrastructure changes..." },
				"planning",
			);
			const plan = await runTofu(
				binary,
				["plan", "-input=false", "-no-color", "-out=tfplan.bin"],
				{
					cwd,
					env: extraEnv,
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
			});
			if (show.code !== 0)
				throw new Error(`tofu show failed:\n${tail(show.output)}`);

			summary = summarizePlan(JSON.parse(show.output) as TofuPlanJson);
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
				message: `Plan ready — ${summary.create} to create, ${summary.update} to update, ${summary.destroy} to destroy. Awaiting approval.`,
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
