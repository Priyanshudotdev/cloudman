import { env } from "@my-better-t-app/env/db";
import mongoose from "mongoose";

await mongoose.connect(env.DATABASE_URL);

const client = mongoose.connection.getClient().db();

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
export { client };
