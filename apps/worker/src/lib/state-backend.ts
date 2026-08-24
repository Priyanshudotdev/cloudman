import {
	CreateBucketCommand,
	HeadBucketCommand,
	S3Client,
} from "@aws-sdk/client-s3";

export interface AwsCreds {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken?: string;
}

/** Deterministic per-project state bucket name (globally unique via project id). */
export function stateBucketName(projectId: string): string {
	return `cloudman-tfstate-${projectId.toLowerCase()}`;
}

export function createStateClient(creds: AwsCreds, region: string): S3Client {
	return new S3Client({
		region,
		credentials: {
			accessKeyId: creds.accessKeyId,
			secretAccessKey: creds.secretAccessKey,
			...(creds.sessionToken ? { sessionToken: creds.sessionToken } : {}),
		},
	});
}

/**
 * Ensures the project's state bucket exists, creating it when missing.
 * us-east-1 buckets are created without a LocationConstraint.
 */
export async function ensureStateBucket(
	client: S3Client,
	bucket: string,
	region: string,
): Promise<"exists" | "created"> {
	try {
		await client.send(new HeadBucketCommand({ Bucket: bucket }));
		return "exists";
	} catch (error) {
		const name =
			error instanceof Error && "name" in error
				? (error as { name?: string }).name
				: undefined;
		if (name !== "NotFound" && name !== "404") {
			throw new Error(
				`state bucket "${bucket}" not accessible: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	try {
		await client.send(
			new CreateBucketCommand({
				Bucket: bucket,
				...(region !== "us-east-1"
					? {
							CreateBucketConfiguration: {
								LocationConstraint: region as never,
							},
						}
					: {}),
			}),
		);
		return "created";
	} catch (error) {
		const name =
			error instanceof Error && "name" in error
				? (error as { name?: string }).name
				: undefined;
		if (name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists") {
			return "exists";
		}
		throw new Error(
			`failed to create state bucket "${bucket}": ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * backend.tf pointing OpenTofu at the project's S3 state object with native
 * S3 lockfile locking (OpenTofu >= 1.7). Credentials come from the process
 * environment that tofu runs with.
 */
export function backendTfContents(
	bucket: string,
	region: string,
	projectId: string,
): string {
	return `terraform {
  backend "s3" {
    bucket       = "${bucket}"
    key          = "projects/${projectId}/terraform.tfstate"
    region       = "${region}"
    use_lockfile = true
  }
}
`;
}
