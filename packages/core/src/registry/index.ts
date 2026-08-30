import { albResource } from "./resources/alb";
import { apiGatewayResource } from "./resources/apigateway";
import { auroraResource } from "./resources/aurora";
import { cloudwatchLogGroupResource } from "./resources/cloudwatch-log-group";
import { dynamoDbResource } from "./resources/dynamodb";
import { ebsResource } from "./resources/ebs";
import { ec2Resource } from "./resources/ec2";
import { ecrResource } from "./resources/ecr";
import { ecsResource } from "./resources/ecs";
import { efsResource } from "./resources/efs";
import { elasticacheResource } from "./resources/elasticache";
import { iamPolicyResource } from "./resources/iam-policy";
import { iamRoleResource } from "./resources/iam-role";
import { internetGatewayResource } from "./resources/internet-gateway";
import { lambdaResource } from "./resources/lambda";
import { natGatewayResource } from "./resources/nat-gateway";
import { rdsResource } from "./resources/rds";
import { route53RecordResource } from "./resources/route53-record";
import { route53ZoneResource } from "./resources/route53-zone";
import { s3Resource } from "./resources/s3";
import { securityGroupResource } from "./resources/security-group";
import { snsResource } from "./resources/sns";
import { sqsResource } from "./resources/sqs";
import { subnetResource } from "./resources/subnet";
import { vpcResource } from "./resources/vpc";
import type { RegisteredResource } from "./types";

const resources: readonly RegisteredResource[] = [
	ec2Resource,
	s3Resource,
	vpcResource,
	subnetResource,
	securityGroupResource,
	dynamoDbResource,
	rdsResource,
	internetGatewayResource,
	natGatewayResource,
	albResource,
	ecrResource,
	lambdaResource,
	ecsResource,
	ebsResource,
	efsResource,
	auroraResource,
	elasticacheResource,
	iamRoleResource,
	iamPolicyResource,
	sqsResource,
	snsResource,
	route53ZoneResource,
	route53RecordResource,
	cloudwatchLogGroupResource,
	apiGatewayResource,
];

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

export type { AlbConfig } from "./resources/alb";
export {
	ALB_PROTOCOLS,
	ALB_SCHEMES,
	albConfigSchema,
	albResource,
} from "./resources/alb";
export type { ApiGatewayConfig } from "./resources/apigateway";
export {
	API_GATEWAY_METHODS,
	apiGatewayConfigSchema,
	apiGatewayResource,
} from "./resources/apigateway";
export type { AuroraConfig } from "./resources/aurora";
export {
	AURORA_ENGINES,
	AURORA_INSTANCE_CLASSES,
	auroraConfigSchema,
	auroraResource,
} from "./resources/aurora";
export type { CloudwatchLogGroupConfig } from "./resources/cloudwatch-log-group";
export {
	cloudwatchLogGroupConfigSchema,
	cloudwatchLogGroupResource,
	LOG_RETENTION_DAYS,
} from "./resources/cloudwatch-log-group";
export type { DynamoDbConfig } from "./resources/dynamodb";
export {
	DYNAMODB_BILLING_MODES,
	DYNAMODB_KEY_TYPES,
	dynamoDbConfigSchema,
	dynamoDbResource,
} from "./resources/dynamodb";
export type { EbsConfig } from "./resources/ebs";
export {
	EBS_VOLUME_TYPES,
	ebsConfigSchema,
	ebsResource,
} from "./resources/ebs";
export type { Ec2Config } from "./resources/ec2";
export {
	EC2_INSTANCE_TYPES,
	ec2ConfigSchema,
	ec2Resource,
} from "./resources/ec2";
export type { EcrConfig } from "./resources/ecr";
export {
	ECR_TAG_MUTABILITIES,
	ecrConfigSchema,
	ecrResource,
} from "./resources/ecr";
export type { EcsConfig } from "./resources/ecs";
export {
	ECS_CPU_SIZES,
	ECS_MEMORY_SIZES,
	ecsConfigSchema,
	ecsResource,
} from "./resources/ecs";
export type { EfsConfig } from "./resources/efs";
export {
	EFS_PERFORMANCE_MODES,
	EFS_THROUGHPUT_MODES,
	efsConfigSchema,
	efsResource,
} from "./resources/efs";
export type { ElasticacheConfig } from "./resources/elasticache";
export {
	ELASTICACHE_ENGINES,
	ELASTICACHE_NODE_TYPES,
	elasticacheConfigSchema,
	elasticacheResource,
} from "./resources/elasticache";
export type { IamPolicyConfig } from "./resources/iam-policy";
export {
	iamPolicyConfigSchema,
	iamPolicyResource,
} from "./resources/iam-policy";
export type { IamRoleConfig } from "./resources/iam-role";
export {
	IAM_ASSUME_SERVICES,
	iamRoleConfigSchema,
	iamRoleResource,
} from "./resources/iam-role";
export type { InternetGatewayConfig } from "./resources/internet-gateway";
export {
	internetGatewayConfigSchema,
	internetGatewayResource,
} from "./resources/internet-gateway";
export type { LambdaConfig } from "./resources/lambda";
export {
	LAMBDA_CODE_SOURCES,
	LAMBDA_RUNTIMES,
	lambdaConfigSchema,
	lambdaResource,
} from "./resources/lambda";
export type { NatGatewayConfig } from "./resources/nat-gateway";
export {
	NAT_CONNECTIVITY_TYPES,
	natGatewayConfigSchema,
	natGatewayResource,
} from "./resources/nat-gateway";
export type { RdsConfig } from "./resources/rds";
export {
	RDS_ENGINES,
	RDS_INSTANCE_CLASSES,
	rdsConfigSchema,
	rdsResource,
} from "./resources/rds";
export type { Route53RecordConfig } from "./resources/route53-record";
export {
	ROUTE53_RECORD_TYPES,
	route53RecordConfigSchema,
	route53RecordResource,
} from "./resources/route53-record";
export type { Route53ZoneConfig } from "./resources/route53-zone";
export {
	route53ZoneConfigSchema,
	route53ZoneResource,
} from "./resources/route53-zone";
export type { S3Config } from "./resources/s3";
export { s3ConfigSchema, s3Resource } from "./resources/s3";
export type {
	IngressRule,
	SecurityGroupConfig,
} from "./resources/security-group";
export {
	ingressRuleSchema,
	SG_PROTOCOLS,
	securityGroupConfigSchema,
	securityGroupResource,
} from "./resources/security-group";
export type { SnsConfig } from "./resources/sns";
export { snsConfigSchema, snsResource } from "./resources/sns";
export type { SqsConfig } from "./resources/sqs";
export { sqsConfigSchema, sqsResource } from "./resources/sqs";
export type { SubnetConfig } from "./resources/subnet";
export { subnetConfigSchema, subnetResource } from "./resources/subnet";
export type { VpcConfig } from "./resources/vpc";
export { vpcConfigSchema, vpcResource } from "./resources/vpc";
export * from "./types";
