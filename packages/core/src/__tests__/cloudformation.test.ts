import { describe, expect, test } from "bun:test";
import { exportCloudFormation } from "../index";
import type { IRDocument, IRResource } from "../ir/schema";

type CfnResource = {
	Type: string;
	DependsOn?: string[];
	Properties?: Record<string, unknown>;
};

type CfnTemplate = {
	AWSTemplateFormatVersion?: string;
	Resources: Record<string, CfnResource>;
};

function resource(
	irId: string,
	kind: string,
	attributes: Record<string, unknown>,
	dependsOn: string[] = [],
): IRResource {
	return { irId, kind, name: irId, label: irId, attributes, dependsOn };
}

function template(document: IRDocument): CfnTemplate {
	const parsed = JSON.parse(exportCloudFormation(document)) as CfnTemplate;
	expect(parsed.AWSTemplateFormatVersion).toBe("2010-09-09");
	return parsed;
}

function resourceOf(t: CfnTemplate, id: string): CfnResource {
	const found = t.Resources[id];
	if (!found) throw new Error(`missing resource ${id}`);
	return found;
}

function types(document: IRDocument): string[] {
	return Object.values(template(document).Resources).map((r) => r.Type);
}

describe("exportCloudFormation", () => {
	test("maps every catalog kind to an AWS:: resource type", () => {
		const doc: IRDocument = {
			version: 1,
			name: "all-kinds",
			region: "us-east-1",
			resources: [
				resource("web", "aws_instance", {
					instance_type: "t3.small",
					volume_size_gb: 20,
					ami: "ami-x",
					subnet_ref: "subnet",
					security_group_refs: ["sg"],
				}),
				resource("data", "aws_s3_bucket", {
					versioning: true,
					force_destroy: false,
					bucket: "cloudman",
				}),
				resource("vpc", "aws_vpc", {
					cidr_block: "10.0.0.0/16",
					enable_dns_hostnames: true,
				}),
				resource("subnet", "aws_subnet", {
					vpc_ref: "vpc",
					cidr_block: "10.0.1.0/24",
					availability_zone: "us-east-1a",
				}),
				resource("sg", "aws_security_group", {
					vpc_ref: "vpc",
					description: "web",
					ingress_rules: [
						{
							protocol: "tcp",
							from_port: 443,
							to_port: 443,
							cidr_block: "0.0.0.0/0",
						},
					],
				}),
				resource("table", "aws_dynamodb_table", {
					hash_key: "id",
					hash_key_type: "S",
					range_key: "sk",
					billing_mode: "pay_per_request",
				}),
				resource("db", "aws_db_instance", {
					engine: "postgres",
					instance_class: "db.t3.micro",
					allocated_storage_gb: 20,
					subnet_refs: ["subnet"],
					security_group_refs: ["sg"],
				}),
				resource("igw", "aws_internet_gateway", { vpc_ref: "vpc" }),
				resource("nat", "aws_nat_gateway", { subnet_ref: "subnet" }),
				resource("lb", "aws_lb", {
					internal: false,
					subnet_refs: ["subnet"],
					security_group_refs: ["sg"],
					vpc_ref: "vpc",
					listener_port: 80,
					listener_protocol: "HTTP",
					health_check_path: "/",
					target_refs: ["web"],
				}),
				resource("repo", "aws_ecr_repository", {
					scan_on_push: true,
					image_tag_mutability: "mutable",
				}),
				resource("fn", "aws_lambda_function", {
					runtime: "python3.12",
					handler: "index.handler",
					memory_size: 256,
					timeout: 30,
					iam_role_ref: "role",
					code_source: "image",
					repository_refs: ["repo"],
					subnet_refs: ["subnet"],
					security_group_refs: ["sg"],
				}),
				resource("cluster", "aws_ecs_cluster", {
					image: "nginx:latest",
					cpu: 256,
					memory: 512,
					container_port: 80,
					iam_role_ref: "role",
					subnet_refs: ["subnet"],
					security_group_refs: ["sg"],
					assign_public_ip: true,
					desired_count: 2,
				}),
				resource("vol", "aws_ebs_volume", {
					size_gb: 10,
					volume_type: "gp3",
					encrypted: true,
					iops: 3000,
					instance_ref: "web",
					device: "/dev/sdf",
				}),
				resource("fs", "aws_efs_file_system", {
					performance_mode: "generalPurpose",
					throughput_mode: "bursting",
					encrypted: true,
				}),
				resource("aurora", "aws_rds_cluster", {
					engine: "aurora-postgresql",
					instance_class: "db.r6g.large",
					db_name: "app",
					db_username: "cloudman",
					subnet_refs: ["subnet"],
					security_group_refs: ["sg"],
				}),
				resource("cache", "aws_elasticache_cluster", {
					engine: "redis",
					node_type: "cache.t3.micro",
					num_cache_nodes: 1,
					port: 6379,
					subnet_refs: ["subnet"],
					security_group_refs: ["sg"],
				}),
				resource("role", "aws_iam_role", { assume_service: "lambda" }),
				resource("policy", "aws_iam_policy", {
					policy_name: "p",
					actions: ["s3:GetObject"],
					resources: ["arn:aws:s3:::b/*"],
					role_refs: ["role"],
				}),
				resource("queue", "aws_sqs_queue", {
					visibility_timeout_seconds: 60,
					delay_seconds: 5,
					fifo_queue: true,
				}),
				resource("topic", "aws_sns_topic", { display_name: "alerts" }),
				resource("zone", "aws_route53_zone", {
					zone_name: "example.com",
					private_zone: true,
					vpc_ref: "vpc",
				}),
				resource("rec", "aws_route53_record", {
					record_name: "www.example.com",
					record_type: "A",
					zone_ref: "zone",
					ttl: 300,
					records: ["203.0.113.10"],
				}),
				resource("logs", "aws_cloudwatch_log_group", {
					retention_days: 30,
				}),
				resource("api", "aws_api_gateway_rest_api", {
					http_method: "POST",
					stage_name: "v1",
					lambda_refs: ["fn"],
				}),
			],
		};

		const t = types(doc);
		const expected = [
			"AWS::EC2::Instance",
			"AWS::S3::Bucket",
			"AWS::EC2::VPC",
			"AWS::EC2::Subnet",
			"AWS::EC2::SecurityGroup",
			"AWS::DynamoDB::Table",
			"AWS::RDS::DBInstance",
			"AWS::RDS::DBSubnetGroup",
			"AWS::EC2::InternetGateway",
			"AWS::EC2::VPCGatewayAttachment",
			"AWS::EC2::NatGateway",
			"AWS::EC2::EIP",
			"AWS::ElasticLoadBalancingV2::LoadBalancer",
			"AWS::ElasticLoadBalancingV2::TargetGroup",
			"AWS::ElasticLoadBalancingV2::Listener",
			"AWS::ECR::Repository",
			"AWS::Lambda::Function",
			"AWS::ECS::Cluster",
			"AWS::ECS::TaskDefinition",
			"AWS::ECS::Service",
			"AWS::EC2::Volume",
			"AWS::EC2::VolumeAttachment",
			"AWS::EFS::FileSystem",
			"AWS::RDS::DBCluster",
			"AWS::ElastiCache::CacheCluster",
			"AWS::ElastiCache::SubnetGroup",
			"AWS::IAM::Role",
			"AWS::IAM::Policy",
			"AWS::SQS::Queue",
			"AWS::SNS::Topic",
			"AWS::Route53::HostedZone",
			"AWS::Route53::RecordSet",
			"AWS::Logs::LogGroup",
			"AWS::ApiGateway::RestApi",
			"AWS::ApiGateway::Method",
			"AWS::ApiGateway::Deployment",
			"AWS::ApiGateway::Stage",
		];
		for (const type of expected) expect(t).toContain(type);
		const singleEmission = expected.filter(
			(type) => type !== "AWS::RDS::DBSubnetGroup",
		);
		for (const type of singleEmission)
			expect(
				t.filter((entry) => entry === type),
				`type ${type} should be emitted exactly once`,
			).toHaveLength(1);
	});

	test("wires refs and DependsOn across a networking stack", () => {
		const doc: IRDocument = {
			version: 1,
			name: "net",
			region: "us-east-1",
			resources: [
				resource("vpc", "aws_vpc", {
					cidr_block: "10.0.0.0/16",
					enable_dns_hostnames: true,
				}),
				resource("subnet", "aws_subnet", {
					vpc_ref: "vpc",
					cidr_block: "10.0.1.0/24",
				}),
				resource("sg", "aws_security_group", { vpc_ref: "vpc" }),
				resource(
					"web",
					"aws_instance",
					{
						instance_type: "t3.small",
						subnet_ref: "subnet",
						security_group_refs: ["sg"],
					},
					["subnet", "sg"],
				),
			],
		};

		const t = template(doc);
		const ec2 = resourceOf(t, "EC2InstanceWeb");
		expect(ec2.Type).toBe("AWS::EC2::Instance");
		expect(ec2.Properties?.InstanceType).toBe("t3.small");
		expect(ec2.DependsOn).toEqual(["SubnetSubnet", "SecurityGroupSg"]);
		expect(ec2.Properties?.SubnetId).toEqual({ Ref: "SubnetSubnet" });
		expect(ec2.Properties?.SecurityGroupIds).toEqual([
			{ "Fn::GetAtt": ["SecurityGroupSg", "GroupId"] },
		]);

		const subnet = resourceOf(t, "SubnetSubnet");
		expect(subnet.Properties?.VpcId).toEqual({ Ref: "VPCVpc" });

		const sg = resourceOf(t, "SecurityGroupSg");
		expect(sg.Properties?.VpcId).toEqual({ Ref: "VPCVpc" });
	});

	test("emits EIP + NAT pair and IGW + attachment as sibling resources", () => {
		const doc: IRDocument = {
			version: 1,
			name: "ext",
			region: "us-east-1",
			resources: [
				resource("vpc", "aws_vpc", { cidr_block: "10.0.0.0/16" }),
				resource("subnet", "aws_subnet", { vpc_ref: "vpc" }),
				resource("igw", "aws_internet_gateway", { vpc_ref: "vpc" }),
				resource("nat", "aws_nat_gateway", { subnet_ref: "subnet" }),
			],
		};

		const t = template(doc);
		const igw = resourceOf(t, "InternetGatewayIgw");
		expect(igw.Type).toBe("AWS::EC2::InternetGateway");
		const attachment = resourceOf(t, "InternetGatewayIgwAttachment");
		expect(attachment.Type).toBe("AWS::EC2::VPCGatewayAttachment");
		expect(attachment.Properties?.VpcId).toEqual({ Ref: "VPCVpc" });
		expect(attachment.Properties?.InternetGatewayId).toEqual({
			Ref: "InternetGatewayIgw",
		});

		const nat = resourceOf(t, "NatGatewayNat");
		expect(nat.Type).toBe("AWS::EC2::NatGateway");
		expect(nat.Properties?.SubnetId).toEqual({ Ref: "SubnetSubnet" });
		expect(nat.Properties?.AllocationId).toEqual({ Ref: "NatGatewayNatEIP" });
		const eip = resourceOf(t, "NatGatewayNatEIP");
		expect(eip.Type).toBe("AWS::EC2::EIP");
	});

	test("alb forwards to its target group via listener", () => {
		const doc: IRDocument = {
			version: 1,
			name: "web",
			region: "us-east-1",
			resources: [
				resource("vpc", "aws_vpc", { cidr_block: "10.0.0.0/16" }),
				resource("subnet", "aws_subnet", { vpc_ref: "vpc" }),
				resource("web", "aws_instance", { subnet_ref: "subnet" }),
				resource("lb", "aws_lb", {
					subnet_refs: ["subnet"],
					vpc_ref: "vpc",
					listener_port: 80,
					target_refs: ["web"],
				}),
			],
		};

		const t = template(doc);
		const targetGroup = resourceOf(t, "LoadBalancerLbTargetGroup");
		expect(targetGroup.Type).toBe("AWS::ElasticLoadBalancingV2::TargetGroup");
		expect(targetGroup.Properties?.Targets).toEqual([
			{ Id: { "Fn::GetAtt": ["EC2InstanceWeb", "InstanceId"] } },
		]);
		const listener = resourceOf(t, "LoadBalancerLbListener");
		expect(listener.Type).toBe("AWS::ElasticLoadBalancingV2::Listener");
		expect(listener.Properties?.LoadBalancerArn).toEqual({
			"Fn::GetAtt": ["LoadBalancerLb", "Arn"],
		});
		expect(listener.Properties?.DefaultActions).toEqual([
			{ Type: "forward", TargetGroupArn: { Ref: "LoadBalancerLbTargetGroup" } },
		]);
	});

	test("ecs service references the synthesized task definition", () => {
		const doc: IRDocument = {
			version: 1,
			name: "svc",
			region: "us-east-1",
			resources: [
				resource("svc", "aws_ecs_cluster", {
					image: "nginx:latest",
					cpu: 256,
					memory: 512,
					container_port: 8080,
					desired_count: 1,
				}),
			],
		};

		const t = template(doc);
		const task = resourceOf(t, "ECSClusterSvcTaskDefinition");
		expect(task.Type).toBe("AWS::ECS::TaskDefinition");
		const containers = task.Properties?.ContainerDefinitions as
			| Array<Record<string, unknown>>
			| undefined;
		expect(containers?.[0]?.Image).toBe("nginx:latest");
		expect(containers?.[0]?.PortMappings).toEqual([
			{ ContainerPort: 8080, Protocol: "tcp" },
		]);
		const service = resourceOf(t, "ECSClusterSvcService");
		expect(service.Type).toBe("AWS::ECS::Service");
		expect(service.Properties?.Cluster).toEqual({ Ref: "ECSClusterSvc" });
		expect(service.Properties?.TaskDefinition).toEqual({
			Ref: "ECSClusterSvcTaskDefinition",
		});
	});

	test("api gateway stages deployment after method with DependsOn chain", () => {
		const doc: IRDocument = {
			version: 1,
			name: "api",
			region: "us-east-1",
			resources: [
				resource("repo", "aws_ecr_repository", {}),
				resource("fn", "aws_lambda_function", {
					code_source: "image",
					repository_refs: ["repo"],
				}),
				resource("api", "aws_api_gateway_rest_api", {
					http_method: "POST",
					lambda_refs: ["fn"],
				}),
			],
		};

		const t = template(doc);
		const method = resourceOf(t, "ApiGatewayRestApiApiMethod");
		expect(method.Type).toBe("AWS::ApiGateway::Method");
		const integration = method.Properties?.Integration as
			| Record<string, unknown>
			| undefined;
		expect(integration?.Type).toBe("AWS_PROXY");
		const deployment = resourceOf(t, "ApiGatewayRestApiApiDeployment");
		expect(deployment.DependsOn).toEqual(["ApiGatewayRestApiApiMethod"]);
		const stage = resourceOf(t, "ApiGatewayRestApiApiStage");
		expect(stage.DependsOn).toEqual(["ApiGatewayRestApiApiDeployment"]);
		expect(stage.Properties?.StageName).toBe("v1");
	});

	test("static dns records render as ResourceRecords with TTL", () => {
		const doc: IRDocument = {
			version: 1,
			name: "dns",
			region: "us-east-1",
			resources: [
				resource("zone", "aws_route53_zone", { zone_name: "example.com" }),
				resource("rec", "aws_route53_record", {
					record_name: "www.example.com",
					record_type: "A",
					zone_ref: "zone",
					ttl: 300,
					records: ["203.0.113.10"],
				}),
			],
		};

		const rec = resourceOf(template(doc), "Route53RecordRec");
		expect(rec.Properties?.ResourceRecords).toEqual(["203.0.113.10"]);
		expect(rec.Properties?.TTL).toBe(300);
		expect(rec.Properties?.HostedZoneId).toEqual({ Ref: "HostedZoneZone" });
	});

	test("lambda image uri is assembled from the wired ecr repository", () => {
		const doc: IRDocument = {
			version: 1,
			name: "fn",
			region: "us-east-1",
			resources: [
				resource("repo", "aws_ecr_repository", {}),
				resource("fn", "aws_lambda_function", {
					code_source: "image",
					repository_refs: ["repo"],
					runtime: "python3.12",
				}),
			],
		};

		const fn = resourceOf(template(doc), "LambdaFunctionFn");
		expect(fn.Type).toBe("AWS::Lambda::Function");
		expect(fn.Properties?.Runtime).toBe("python3.12");
		expect(fn.Properties?.Code).toEqual({
			ImageUri: {
				"Fn::Join": [
					"",
					[{ "Fn::GetAtt": ["ECRRepositoryRepo", "Arn"] }, ":latest"],
				],
			},
		});
	});
});
