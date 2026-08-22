export type { CompiledFile, CompileOptions } from "./compiler";
export { compileIR } from "./compiler";
export * from "./graph/dependencies";
export * from "./graph/schema";
export * from "./graph/validate";
export * from "./ir/schema";
export type { BuildIROptions, IRBuildResult } from "./ir/transform";
export { buildIR, DEFAULT_REGION, sanitizeTofuName } from "./ir/transform";
export type {
	Ec2Config,
	RegisteredResource,
	ResourceCategory,
	S3Config,
} from "./registry";
export {
	EC2_INSTANCE_TYPES,
	ec2ConfigSchema,
	ec2Resource,
	getResourceDefinition,
	listResourceDefinitions,
	s3ConfigSchema,
	s3Resource,
} from "./registry";
