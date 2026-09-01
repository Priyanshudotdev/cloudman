import { env } from "@my-better-t-app/env/db";
import type { Db } from "mongodb";
import mongoose from "mongoose";

const globalForDb = globalThis as unknown as {
	cloudmanDbPromise?: Promise<Db>;
};

export function getClient(): Promise<Db> {
	if (!globalForDb.cloudmanDbPromise) {
		globalForDb.cloudmanDbPromise = mongoose
			.connect(env.DATABASE_URL)
			.then(() => mongoose.connection.getClient().db());
	}
	return globalForDb.cloudmanDbPromise;
}

export {
	decryptSecret,
	encryptSecret,
	resolveExternalId,
} from "./lib/crypto";
export { AwsConnection } from "./models/aws-connection.model";
export type { DeploymentStatus } from "./models/deployment.model";
export {
	DEPLOYMENT_STATUSES,
	Deployment,
} from "./models/deployment.model";
export { GraphVersion } from "./models/graph-version.model";
export { Project } from "./models/project.model";