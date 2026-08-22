import { ec2Resource } from "./resources/ec2";
import { s3Resource } from "./resources/s3";
import type { RegisteredResource } from "./types";

const resources: readonly RegisteredResource[] = [ec2Resource, s3Resource];

const byType = new Map<string, RegisteredResource>(
	resources.map((r) => [r.type, r]),
);

export function getResourceDefinition(
	type: string,
): RegisteredResource | undefined {
	return byType.get(type);
}

export function listResourceDefinitions(): RegisteredResource[] {
	return [...byType.values()];
}

export type { Ec2Config } from "./resources/ec2";
export {
	EC2_INSTANCE_TYPES,
	ec2ConfigSchema,
	ec2Resource,
} from "./resources/ec2";
export type { S3Config } from "./resources/s3";
export { s3ConfigSchema, s3Resource } from "./resources/s3";
export * from "./types";
