export type { CompiledFile, CompileOptions } from "./compiler";
export { compileIR } from "./compiler";
export * from "./graph/cidr";
export * from "./graph/dependencies";
export type { NodeRefs } from "./graph/refs";
export { resolveNodeRefs, sgEffectiveVpc } from "./graph/refs";
export * from "./graph/schema";
export * from "./graph/validate";
export * from "./ir/schema";
export type { BuildIROptions, IRBuildResult } from "./ir/transform";
export { buildIR, DEFAULT_REGION, sanitizeTofuName } from "./ir/transform";
export type {
	Ec2Config,
	IngressRule,
	RegisteredResource,
	ResourceCategory,
	S3Config,
	SecurityGroupConfig,
	SubnetConfig,
	VpcConfig,
} from "./registry";
export {
	EC2_INSTANCE_TYPES,
	ec2ConfigSchema,
	ec2Resource,
	getResourceDefinition,
	ingressRuleSchema,
	listResourceDefinitions,
	SG_PROTOCOLS,
	s3ConfigSchema,
	s3Resource,
	securityGroupConfigSchema,
	securityGroupResource,
	subnetConfigSchema,
	subnetResource,
	vpcConfigSchema,
	vpcResource,
} from "./registry";
