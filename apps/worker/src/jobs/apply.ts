import {
	AwsConnection,
	Deployment,
	resolveExternalId,
} from "@my-better-t-app/db";
import { env } from "@my-better-t-app/env/worker";
import type { InfraApplyJobData } from "@my-better-t-app/queue";
import type { Job } from "bullmq";
import { resolveAwsCredentials } from "../lib/aws";
import { recordDeploymentEvent, sleep, tail } from "../lib/events";
import { runTofu } from "../lib/tofu";
import { cleanupWorkspace, workspacePath } from "../lib/workspace";

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

export async function handleApplyJob(
	job: Job<InfraApplyJobData>,
): Promise<void> {
	const { deploymentId } = job.data;

	const deployment = await Deployment.findById(deploymentId).lean();
	if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);
	if (deployment.status !== "apply_queued") {
		console.log(
			`[worker] apply job skipped — status is "${deployment.status}"`,
		);
		return;
	}

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
	const summary = deployment.planSummary;
	const isDestroy = deployment.action === "destroy";
	const projectId = String(deployment.projectId);

	try {
		await recordDeploymentEvent(
			deploymentId,
			{
				level: isDestroy ? "error" : "info",
				message: isDestroy
					? `DESTROYING infrastructure — ${summary?.destroy ?? 0} resource(s) will be removed.`
					: `Applying infrastructure — ${summary?.create ?? 0} to create, ${summary?.update ?? 0} to update, ${summary?.destroy ?? 0} to destroy.`,
			},
			"applying",
		);

		if (env.CLOUDMAN_WORKER_MOCK === "1") {
			const resources = summary?.resources ?? [];
			for (const resource of resources) {
				await sleep(700);
				await recordDeploymentEvent(deploymentId, {
					level: "progress",
					message: `${isDestroy ? "Destroying" : "Creating"} ${resource.address}... (mock)`,
				});
			}
			await sleep(500);
		} else {
			const binary = await resolveBinary();
			const creds = await resolveAwsCredentials(connection, deploymentId);
			const cwd = workspacePath(projectId);

			const apply = await runTofu(
				binary,
				["apply", "-auto-approve", "-input=false", "-no-color", "tfplan.bin"],
				{
					cwd,
					env: awsEnv(creds, region),
					timeoutMs: 20 * 60 * 1000,
					onLine: (line) => {
						void recordDeploymentEvent(deploymentId, {
							level: "progress",
							message: line.trim(),
						});
					},
				},
			);

			if (apply.code !== 0) {
				throw new Error(
					`tofu apply failed with exit code ${apply.code}:\n${tail(apply.output)}`,
				);
			}
		}

		// After a successful destroy the state is empty — safe to remove the
		// project workspace. Provision keeps it for future destroys.
		if (isDestroy) {
			await cleanupWorkspace(projectId);
		}

		await Deployment.updateOne(
			{ _id: deploymentId },
			{
				$set: {
					status: "completed",
					completedAt: new Date(),
					updatedAt: new Date(),
				},
			},
		);
		await recordDeploymentEvent(
			deploymentId,
			{
				level: "success",
				message: isDestroy
					? "Infrastructure destroyed. All resources removed."
					: "Deployment complete.",
			},
			"completed",
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await recordDeploymentEvent(
			deploymentId,
			{ level: "error", message: `Apply failed: ${message}` },
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
