import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";

import { env } from "@my-better-t-app/env/worker";

export interface AwsConnectionRef {
	roleArn: string;
	externalId: string;
}

export interface ResolvedAwsCredentials {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken?: string;
	source: "assumed-role" | "environment";
}

/**
 * Credential resolution order:
 * 1. STS AssumeRole into the user's stored AwsConnection (roleArn + externalId)
 * 2. Worker-level AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env fallback (dev only)
 */
export async function resolveAwsCredentials(
	connection: AwsConnectionRef | null,
	deploymentId: string,
): Promise<ResolvedAwsCredentials> {
	if (connection) {
		const sts = new STSClient({ region: env.AWS_REGION });
		const result = await sts.send(
			new AssumeRoleCommand({
				RoleArn: connection.roleArn,
				RoleSessionName: `cloudman-${deploymentId.slice(0, 24)}`,
				ExternalId: connection.externalId,
				DurationSeconds: 3600,
			}),
		);
		const creds = result.Credentials;
		if (!creds?.AccessKeyId || !creds.SecretAccessKey) {
			throw new Error("STS AssumeRole returned empty credentials");
		}
		return {
			accessKeyId: creds.AccessKeyId,
			secretAccessKey: creds.SecretAccessKey,
			sessionToken: creds.SessionToken,
			source: "assumed-role",
		};
	}

	if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
		return {
			accessKeyId: env.AWS_ACCESS_KEY_ID,
			secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
			source: "environment",
		};
	}

	throw new Error(
		"No AWS credentials available: connect an AWS account (role ARN) or set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY on the worker.",
	);
}
