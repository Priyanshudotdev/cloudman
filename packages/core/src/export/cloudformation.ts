import type { IRDocument, IRResource } from "../ir/schema";

/**
 * Best-effort CloudFormation template generation from a compiled IR document.
 * The template is JSON and shares the same logical graph as the OpenTofu plan
 * so both artifacts describe the same infrastructure.
 */

const KIND_PREFIX: Record<string, string> = {
	aws_instance: "EC2Instance",
	aws_s3_bucket: "S3Bucket",
	aws_vpc: "VPC",
	aws_subnet: "Subnet",
	aws_security_group: "SecurityGroup",
	aws_dynamodb_table: "DynamoDBTable",
	aws_db_instance: "RDSInstance",
	aws_internet_gateway: "InternetGateway",
	aws_nat_gateway: "NatGateway",
	aws_lb: "LoadBalancer",
	aws_ecr_repository: "ECRRepository",
	aws_lambda_function: "LambdaFunction",
	aws_ecs_cluster: "ECSCluster",
	aws_ebs_volume: "EBSVolume",
	aws_efs_file_system: "EFSFileSystem",
	aws_rds_cluster: "AuroraCluster",
	aws_elasticache_cluster: "ElastiCacheCluster",
	aws_iam_role: "IAMRole",
	aws_iam_policy: "IAMPolicy",
	aws_sqs_queue: "SQSQueue",
	aws_sns_topic: "SNSTopic",
	aws_route53_zone: "HostedZone",
	aws_route53_record: "Route53Record",
	aws_cloudwatch_log_group: "LogGroup",
	aws_api_gateway_rest_api: "ApiGatewayRestApi",
};

function pas(part: string): string {
	const alnum = part.replace(/[^a-zA-Z0-9]/g, "");
	const withLetter = /^[0-9]/.test(alnum) ? `R${alnum}` : alnum;
	if (withLetter.length === 0) return fromHash(part);
	return withLetter.charAt(0).toUpperCase() + withLetter.slice(1);
}

/** Stable fallback so empty logical fragments can never collide. */
function fromHash(input: string): string {
	let hash = 0;
	for (let i = 0; i < input.length; i += 1) {
		hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
	}
	return `R${hash.toString(36)}`;
}

function logicalId(resource: IRResource): string {
	const prefix = KIND_PREFIX[resource.kind] ?? pas(resource.kind);
	return prefix + pas(resource.name);
}

type ExportBlock = { id: string; block: Record<string, unknown> };

function num(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

function str(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function bool(value: unknown): boolean {
	return value === true;
}

function idList(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function ref(id: string): Record<string, unknown> {
	return { Ref: cfnLogicalIds.get(id) ?? id };
}

function getAtt(id: string, attribute: string): Record<string, unknown> {
	return { "Fn::GetAtt": [cfnLogicalIds.get(id) ?? id, attribute] };
}

let cfnLogicalIds = new Map<string, string>();

function nameTag(resource: IRResource): Array<{ Key: string; Value: string }> {
	return [
		{ Key: "Name", Value: resource.label ?? resource.name },
		{ Key: "ManagedBy", Value: "cloudman" },
	];
}

function deps(resource: IRResource, logicalById: Map<string, string>) {
	const deps = resource.dependsOn
		.map((id) => logicalById.get(id))
		.filter((id): id is string => Boolean(id));
	return deps.length > 0 ? deps : undefined;
}

function writeVpc(resource: IRResource): ExportBlock[] {
	return [
		{
			id: logicalId(resource),
			block: {
				Type: "AWS::EC2::VPC",
				Properties: {
					CidrBlock: str(resource.attributes.cidr_block) ?? "10.0.0.0/16",
					EnableDnsSupport: true,
					EnableDnsHostnames: bool(resource.attributes.enable_dns_hostnames),
					Tags: nameTag(resource),
				},
			},
		},
	];
}

function writeSubnet(resource: IRResource): ExportBlock[] {
	const properties: Record<string, unknown> = {
		VpcId: ref(String(resource.attributes.vpc_ref ?? "")),
		CidrBlock: str(resource.attributes.cidr_block) ?? "10.0.1.0/24",
		MapPublicIpOnLaunch: false,
		Tags: nameTag(resource),
	};
	const az = str(resource.attributes.availability_zone);
	if (az) properties.AvailabilityZone = az;
	return [
		{
			id: logicalId(resource),
			block: { Type: "AWS::EC2::Subnet", Properties: properties },
		},
	];
}

function writeSecurityGroup(resource: IRResource): ExportBlock[] {
	const ingress = Array.isArray(resource.attributes.ingress_rules)
		? (resource.attributes.ingress_rules as Array<Record<string, unknown>>).map(
				(rule) => ({
					IpProtocol: str(rule.protocol) ?? "tcp",
					FromPort: num(rule.from_port) ?? 0,
					ToPort: num(rule.to_port) ?? 0,
					CidrIp: str(rule.cidr_block) ?? "0.0.0.0/0",
				}),
			)
		: [];
	return [
		{
			id: logicalId(resource),
			block: {
				Type: "AWS::EC2::SecurityGroup",
				Properties: {
					GroupDescription:
						str(resource.attributes.description) ?? "CloudMan security group",
					VpcId: ref(String(resource.attributes.vpc_ref ?? "")),
					SecurityGroupIngress: ingress,
					Tags: nameTag(resource),
				},
			},
		},
	];
}

function writeEc2(resource: IRResource): ExportBlock[] {
	const attributes = resource.attributes;
	const properties: Record<string, unknown> = {
		ImageId: str(attributes.ami) ?? "ami-cloudman-placeholder",
		InstanceType: str(attributes.instance_type) ?? "t3.micro",
		BlockDeviceMappings: [
			{
				DeviceName: "/dev/xvda",
				Ebs: {
					VolumeSize: num(attributes.volume_size_gb) ?? 8,
					VolumeType: "gp3",
				},
			},
		],
		Tags: nameTag(resource),
	};
	const keyName = str(attributes.key_name);
	if (keyName) properties.KeyName = keyName;
	const subnetRef = str(attributes.subnet_ref);
	if (subnetRef) properties.SubnetId = ref(subnetRef);
	const sgRefs = idList(attributes.security_group_refs);
	if (sgRefs.length > 0)
		properties.SecurityGroupIds = sgRefs.map((id) => getAtt(id, "GroupId"));
	return [
		{
			id: logicalId(resource),
			block: { Type: "AWS::EC2::Instance", Properties: properties },
		},
	];
}

function writeS3(resource: IRResource): ExportBlock[] {
	const properties: Record<string, unknown> = {
		VersioningConfiguration: {
			Status: bool(resource.attributes.versioning) ? "Enabled" : "Suspended",
		},
		Tags: nameTag(resource),
	};
	const bucket = str(resource.attributes.bucket);
	if (bucket) properties.BucketName = bucket;
	const policy = bool(resource.attributes.force_destroy) ? "Delete" : "Retain";
	return [
		{
			id: logicalId(resource),
			block: {
				Type: "AWS::S3::Bucket",
				Properties: properties,
				DeletionPolicy: policy,
				UpdateReplacePolicy: "Retain",
			},
		},
	];
}

function writeDynamoDb(resource: IRResource): ExportBlock[] {
	const attributes = resource.attributes;
	const keySchema: Array<{ AttributeName: string; KeyType: string }> = [];
	const definitions: Array<{
		AttributeName: string;
		AttributeType: string;
	}> = [];
	const hashKey = str(attributes.hash_key) ?? "id";
	keySchema.push({ AttributeName: hashKey, KeyType: "HASH" });
	definitions.push({
		AttributeName: hashKey,
		AttributeType: str(attributes.hash_key_type) ?? "S",
	});
	const rangeKey = str(attributes.range_key);
	if (rangeKey) {
		keySchema.push({ AttributeName: rangeKey, KeyType: "RANGE" });
		definitions.push({
			AttributeName: rangeKey,
			AttributeType: str(attributes.range_key_type) ?? "S",
		});
	}
	const properties: Record<string, unknown> = {
		KeySchema: keySchema,
		AttributeDefinitions: definitions,
		BillingMode:
			str(attributes.billing_mode) === "provisioned"
				? "PROVISIONED"
				: "PAY_PER_REQUEST",
	};
	if (properties.BillingMode === "PROVISIONED") {
		properties.ProvisionedThroughput = {
			ReadCapacityUnits: 1,
			WriteCapacityUnits: 1,
		};
	}
	return [
		{
			id: logicalId(resource),
			block: { Type: "AWS::DynamoDB::Table", Properties: properties },
		},
	];
}

function writeInternetGateway(resource: IRResource): ExportBlock[] {
	const id = logicalId(resource);
	return [
		{
			id,
			block: {
				Type: "AWS::EC2::InternetGateway",
				Properties: { Tags: nameTag(resource) },
			},
		},
		{
			id: `${id}Attachment`,
			block: {
				Type: "AWS::EC2::VPCGatewayAttachment",
				Properties: {
					VpcId: ref(String(resource.attributes.vpc_ref ?? "")),
					InternetGatewayId: ref(id),
				},
			},
		},
	];
}

function writeNatGateway(resource: IRResource): ExportBlock[] {
	const id = logicalId(resource);
	return [
		{
			id,
			block: {
				Type: "AWS::EC2::NatGateway",
				Properties: {
					SubnetId: ref(String(resource.attributes.subnet_ref ?? "")),
					AllocationId: ref(`${id}EIP`),
					Tags: nameTag(resource),
				},
			},
		},
		{
			id: `${id}EIP`,
			block: { Type: "AWS::EC2::EIP", Properties: { Domain: "vpc" } },
		},
	];
}

function writeAlb(resource: IRResource): ExportBlock[] {
	const id = logicalId(resource);
	const attributes = resource.attributes;
	const targetGroupId = `${id}TargetGroup`;
	const listenerId = `${id}Listener`;

	const alb: Record<string, unknown> = {
		Type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
		Properties: {
			Scheme: bool(attributes.internal) ? "internal" : "internet-facing",
			Type: "application",
			IpAddressType: "ipv4",
			Subnets: idList(attributes.subnet_refs).map((subnet) => ref(subnet)),
			Tags: nameTag(resource),
		},
	};
	const sgRefs = idList(attributes.security_group_refs);
	if (sgRefs.length > 0)
		(alb.Properties as Record<string, unknown>).SecurityGroups = sgRefs.map(
			(sg) => getAtt(sg, "GroupId"),
		);

	const targetGroup: Record<string, unknown> = {
		Type: "AWS::ElasticLoadBalancingV2::TargetGroup",
		Properties: {
			Port: num(attributes.listener_port) ?? 80,
			Protocol: str(attributes.listener_protocol) ?? "HTTP",
			VpcId: ref(String(attributes.vpc_ref ?? "")),
			HealthCheckPath: str(attributes.health_check_path) ?? "/",
			HealthCheckProtocol: str(attributes.listener_protocol) ?? "HTTP",
		},
	};
	const targets = idList(attributes.target_refs);
	if (targets.length > 0)
		(targetGroup.Properties as Record<string, unknown>).Targets = targets.map(
			(target) => ({ Id: getAtt(target, "InstanceId") }),
		);

	const blocks: ExportBlock[] = [
		{ id, block: alb },
		{ id: targetGroupId, block: targetGroup },
	];
	if (num(attributes.listener_port) !== undefined) {
		blocks.push({
			id: listenerId,
			block: {
				Type: "AWS::ElasticLoadBalancingV2::Listener",
				Properties: {
					LoadBalancerArn: getAtt(id, "Arn"),
					Port: num(attributes.listener_port),
					Protocol: str(attributes.listener_protocol) ?? "HTTP",
					DefaultActions: [
						{ Type: "forward", TargetGroupArn: ref(targetGroupId) },
					],
				},
			},
		});
	}
	return blocks;
}

function writeEcr(resource: IRResource): ExportBlock[] {
	return [
		{
			id: logicalId(resource),
			block: {
				Type: "AWS::ECR::Repository",
				Properties: {
					ImageScanningConfiguration: {
						ScanOnPush: bool(resource.attributes.scan_on_push),
					},
					ImageTagMutability:
						str(resource.attributes.image_tag_mutability) === "immutable"
							? "IMMUTABLE"
							: "MUTABLE",
					Tags: nameTag(resource),
				},
			},
		},
	];
}

function writeLambda(resource: IRResource): ExportBlock[] {
	const attributes = resource.attributes;
	const properties: Record<string, unknown> = {
		Runtime: str(attributes.runtime) ?? "python3.12",
		Handler: str(attributes.handler) ?? "index.handler",
		MemorySize: num(attributes.memory_size) ?? 256,
		Timeout: num(attributes.timeout) ?? 30,
		Tags: nameTag(resource),
	};
	const roleRef = str(attributes.iam_role_ref);
	properties.Role = roleRef
		? getAtt(roleRef, "Arn")
		: "arn:aws:iam::123456789012:role/cloudman-placeholder";
	if (str(attributes.code_source) === "zip") {
		properties.Code = {
			S3Bucket: str(attributes.s3_bucket),
			S3Key: str(attributes.s3_key),
		};
	} else {
		const repo = idList(attributes.repository_refs)[0];
		if (repo) {
			properties.Code = {
				ImageUri: { "Fn::Join": ["", [getAtt(repo, "Arn"), ":latest"]] },
			};
		} else {
			properties.Code = { ZipFile: "exports.handler = async () => ({});" };
		}
	}
	const subnets = idList(attributes.subnet_refs);
	const sgRefs = idList(attributes.security_group_refs);
	if (subnets.length > 0 || sgRefs.length > 0) {
		properties.VpcConfig = {
			SubnetIds: subnets.map((subnet) => ref(subnet)),
			SecurityGroupIds: sgRefs.map((sg) => getAtt(sg, "GroupId")),
		};
	}
	return [
		{
			id: logicalId(resource),
			block: { Type: "AWS::Lambda::Function", Properties: properties },
		},
	];
}

function writeEcs(resource: IRResource): ExportBlock[] {
	const id = logicalId(resource);
	const attributes = resource.attributes;
	const image: unknown =
		str(attributes.image) ??
		(() => {
			const repo = idList(attributes.repository_refs)[0];
			if (!repo) return "nginx:latest";
			return {
				"Fn::Join": [
					"",
					[getAtt(repo, "Arn"), `:${str(attributes.image_tag) ?? "latest"}`],
				],
			};
		})();

	const container: Record<string, unknown> = {
		Name: `task-${resource.name}`,
		Image: image,
		Essential: true,
		Cpu: num(attributes.cpu) ?? 256,
		Memory: num(attributes.memory) ?? 512,
	};
	const containerPort = num(attributes.container_port);
	if (containerPort !== undefined) {
		container.PortMappings = [
			{ ContainerPort: containerPort, Protocol: "tcp" },
		];
	}

	const taskDefinition: Record<string, unknown> = {
		Type: "AWS::ECS::TaskDefinition",
		Properties: {
			RequiresCompatibilities: ["FARGATE"],
			NetworkMode: "awsvpc",
			Cpu: String(num(attributes.cpu) ?? 256),
			Memory: String(num(attributes.memory) ?? 512),
			ContainerDefinitions: [container],
		},
	};
	const roleRef = str(attributes.iam_role_ref);
	if (roleRef)
		(taskDefinition.Properties as Record<string, unknown>).TaskRoleArn = getAtt(
			roleRef,
			"Arn",
		);

	const service: Record<string, unknown> = {
		Type: "AWS::ECS::Service",
		Properties: {
			Cluster: ref(id),
			TaskDefinition: ref(`${id}TaskDefinition`),
			DesiredCount: num(attributes.desired_count) ?? 1,
			LaunchType: "FARGATE",
		},
	};
	const subnets = idList(attributes.subnet_refs);
	const sgRefs = idList(attributes.security_group_refs);
	if (subnets.length > 0 || sgRefs.length > 0) {
		(service.Properties as Record<string, unknown>).NetworkConfiguration = {
			AwsvpcConfiguration: {
				Subnets: subnets.map((subnet) => ref(subnet)),
				SecurityGroups: sgRefs.map((sg) => getAtt(sg, "GroupId")),
				AssignPublicIp: bool(attributes.assign_public_ip)
					? "ENABLED"
					: "DISABLED",
			},
		};
	}

	return [
		{ id, block: { Type: "AWS::ECS::Cluster", Properties: {} } },
		{
			id: `${id}TaskDefinition`,
			block: taskDefinition,
		},
		{
			id: `${id}Service`,
			block: service,
		},
	];
}

function writeEbs(resource: IRResource): ExportBlock[] {
	const id = logicalId(resource);
	const attributes = resource.attributes;
	const volume: Record<string, unknown> = {
		Type: "AWS::EC2::Volume",
		Properties: {
			Size: num(attributes.size_gb) ?? 8,
			VolumeType: str(attributes.volume_type) ?? "gp3",
			Encrypted: bool(attributes.encrypted),
			Tags: nameTag(resource),
		},
	};
	const iops = num(attributes.iops);
	if (iops !== undefined)
		(volume.Properties as Record<string, unknown>).Iops = iops;
	const instanceRef = str(attributes.instance_ref);
	if (instanceRef) {
		(volume.Properties as Record<string, unknown>).AvailabilityZone = getAtt(
			instanceRef,
			"AvailabilityZone",
		);
	}
	return [
		{ id, block: volume },
		{
			id: `${id}Attachment`,
			block: {
				Type: "AWS::EC2::VolumeAttachment",
				Properties: {
					InstanceId: instanceRef
						? getAtt(instanceRef, "InstanceId")
						: undefined,
					VolumeId: ref(id),
					Device: str(attributes.device) ?? "/dev/sdf",
				},
			},
		},
	];
}

function writeEfs(resource: IRResource): ExportBlock[] {
	return [
		{
			id: logicalId(resource),
			block: {
				Type: "AWS::EFS::FileSystem",
				Properties: {
					PerformanceMode:
						str(resource.attributes.performance_mode) ?? "generalPurpose",
					ThroughputMode:
						str(resource.attributes.throughput_mode) ?? "bursting",
					Encrypted: bool(resource.attributes.encrypted),
					Tags: nameTag(resource),
				},
			},
		},
	];
}

function writeRds(resource: IRResource): ExportBlock[] {
	const id = logicalId(resource);
	const attributes = resource.attributes;
	const properties: Record<string, unknown> = {
		Engine: str(attributes.engine) ?? "postgres",
		DBInstanceClass: str(attributes.instance_class) ?? "db.t3.micro",
		AllocatedStorage: num(attributes.allocated_storage_gb) ?? 20,
		DBName: str(attributes.db_name),
		MasterUsername: str(attributes.username) ?? "cloudman",
		MasterUserPassword: "cloudman-placeholder-ChangeMe",
		PubliclyAccessible: bool(attributes.publicly_accessible),
	};
	const engineVersion = str(attributes.engine_version);
	if (engineVersion) properties.EngineVersion = engineVersion;
	const subnets = idList(attributes.subnet_refs);
	const sgRefs = idList(attributes.security_group_refs);
	if (subnets.length > 0)
		properties.DBSubnetGroupName = ref(`${id}SubnetGroup`);
	if (sgRefs.length > 0)
		properties.VPCSecurityGroups = sgRefs.map((sg) => getAtt(sg, "GroupId"));

	return [
		{ id, block: { Type: "AWS::RDS::DBInstance", Properties: properties } },
		{
			id: `${id}SubnetGroup`,
			block: {
				Type: "AWS::RDS::DBSubnetGroup",
				Properties: {
					DBSubnetGroupDescription: `Subnets for ${resource.name}`,
					SubnetIds: subnets.map((subnet) => ref(subnet)),
				},
			},
		},
	];
}

function writeAurora(resource: IRResource): ExportBlock[] {
	const id = logicalId(resource);
	const attributes = resource.attributes;
	const properties: Record<string, unknown> = {
		Engine: str(attributes.engine) ?? "aurora-postgresql",
		DBClusterInstanceClass: str(attributes.instance_class) ?? "db.r6g.large",
		DBName: str(attributes.db_name),
		MasterUsername: str(attributes.db_username) ?? "cloudman",
		MasterUserPassword: "cloudman-placeholder-ChangeMe",
	};
	const engineVersion = str(attributes.engine_version);
	if (engineVersion) properties.EngineVersion = engineVersion;
	const subnets = idList(attributes.subnet_refs);
	const sgRefs = idList(attributes.security_group_refs);
	if (subnets.length > 0)
		properties.DBSubnetGroupName = ref(`${id}SubnetGroup`);
	if (sgRefs.length > 0)
		properties.VpcSecurityGroupIds = sgRefs.map((sg) => getAtt(sg, "GroupId"));

	return [
		{ id, block: { Type: "AWS::RDS::DBCluster", Properties: properties } },
		{
			id: `${id}SubnetGroup`,
			block: {
				Type: "AWS::RDS::DBSubnetGroup",
				Properties: {
					DBSubnetGroupDescription: `Subnets for ${resource.name}`,
					SubnetIds: subnets.map((subnet) => ref(subnet)),
				},
			},
		},
	];
}

function writeElasticache(resource: IRResource): ExportBlock[] {
	const id = logicalId(resource);
	const attributes = resource.attributes;
	const engine = str(attributes.engine) ?? "redis";
	const properties: Record<string, unknown> = {
		Engine: engine,
		CacheNodeType: str(attributes.node_type) ?? "cache.t3.micro",
		NumCacheNodes: num(attributes.num_cache_nodes) ?? 1,
		Port: num(attributes.port) ?? (engine === "memcached" ? 11211 : 6379),
		Tags: nameTag(resource),
	};
	const subnets = idList(attributes.subnet_refs);
	const sgRefs = idList(attributes.security_group_refs);
	if (subnets.length > 0)
		properties.CacheSubnetGroupName = ref(`${id}SubnetGroup`);
	if (sgRefs.length > 0)
		properties.VpcSecurityGroupIds = sgRefs.map((sg) => getAtt(sg, "GroupId"));
	const parameterGroup = str(attributes.parameter_group_name);
	if (parameterGroup) properties.CacheParameterGroupName = parameterGroup;

	return [
		{
			id,
			block: { Type: "AWS::ElastiCache::CacheCluster", Properties: properties },
		},
		{
			id: `${id}SubnetGroup`,
			block: {
				Type: "AWS::ElastiCache::SubnetGroup",
				Properties: {
					CacheSubnetGroupDescription: `Subnets for ${resource.name}`,
					SubnetIds: subnets.map((subnet) => ref(subnet)),
				},
			},
		},
	];
}

function writeIamRole(resource: IRResource): ExportBlock[] {
	const service = str(resource.attributes.assume_service) ?? "lambda";
	return [
		{
			id: logicalId(resource),
			block: {
				Type: "AWS::IAM::Role",
				Properties: {
					AssumeRolePolicyDocument: {
						Version: "2012-10-17",
						Statement: [
							{
								Effect: "Allow",
								Principal: { Service: [`${service}.amazonaws.com`] },
								Action: ["sts:AssumeRole"],
							},
						],
					},
					ManagedPolicyArns: [
						"arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
					],
					Tags: nameTag(resource),
				},
			},
		},
	];
}

function writeIamPolicy(resource: IRResource): ExportBlock[] {
	const attributes = resource.attributes;
	const roles = idList(attributes.role_refs);
	const properties: Record<string, unknown> = {
		PolicyName: str(attributes.policy_name) ?? `policy-${resource.name}`,
		PolicyDocument: {
			Version: "2012-10-17",
			Statement: [
				{
					Effect: "Allow",
					Action: idList(attributes.actions),
					Resource: idList(attributes.resources),
				},
			],
		},
	};
	if (roles.length > 0) properties.Roles = roles.map((role) => ref(role));
	return [
		{
			id: logicalId(resource),
			block: { Type: "AWS::IAM::Policy", Properties: properties },
		},
	];
}

function writeSqs(resource: IRResource): ExportBlock[] {
	const attributes = resource.attributes;
	const properties: Record<string, unknown> = {
		VisibilityTimeout: num(attributes.visibility_timeout_seconds) ?? 30,
		DelaySeconds: num(attributes.delay_seconds) ?? 0,
	};
	if (bool(attributes.fifo_queue)) {
		properties.FifoQueue = "true";
		properties.QueueName = `${resource.name}.fifo`;
	}
	return [
		{
			id: logicalId(resource),
			block: { Type: "AWS::SQS::Queue", Properties: properties },
		},
	];
}

function writeSns(resource: IRResource): ExportBlock[] {
	const properties: Record<string, unknown> = {};
	const displayName = str(resource.attributes.display_name);
	if (displayName) properties.DisplayName = displayName;
	return [
		{
			id: logicalId(resource),
			block: { Type: "AWS::SNS::Topic", Properties: properties },
		},
	];
}

function writeRoute53Zone(resource: IRResource): ExportBlock[] {
	const attributes = resource.attributes;
	const properties: Record<string, unknown> = {
		Name: str(attributes.zone_name),
	};
	if (bool(attributes.private_zone)) {
		properties.VPCs = [
			{
				VPCId: ref(String(attributes.vpc_ref ?? "")),
				VPCRegion: { Ref: "AWS::Region" },
			},
		];
	}
	return [
		{
			id: logicalId(resource),
			block: { Type: "AWS::Route53::HostedZone", Properties: properties },
		},
	];
}

function writeRoute53Record(resource: IRResource): ExportBlock[] {
	const attributes = resource.attributes;
	const properties: Record<string, unknown> = {
		Name: str(attributes.record_name) ?? "app.place.invalid",
		Type: str(attributes.record_type) ?? "A",
		HostedZoneId: ref(String(attributes.zone_ref ?? "")),
	};
	if (attributes.alias_ref) {
		properties.AliasTarget = {
			DNSName: getAtt(String(attributes.alias_ref), "DNSName"),
			HostedZoneId: getAtt(
				String(attributes.alias_ref),
				"CanonicalHostedZoneID",
			),
		};
	} else {
		const records = idList(attributes.records);
		if (records.length > 0) {
			properties.ResourceRecords = records;
			properties.TTL = num(attributes.ttl) ?? 300;
		}
	}
	return [
		{
			id: logicalId(resource),
			block: { Type: "AWS::Route53::RecordSet", Properties: properties },
		},
	];
}

function writeLogGroup(resource: IRResource): ExportBlock[] {
	const properties: Record<string, unknown> = {};
	const retention = num(resource.attributes.retention_days);
	if (retention !== undefined) properties.RetentionInDays = retention;
	return [
		{
			id: logicalId(resource),
			block: { Type: "AWS::Logs::LogGroup", Properties: properties },
		},
	];
}

function writeApiGateway(resource: IRResource): ExportBlock[] {
	const id = logicalId(resource);
	const attributes = resource.attributes;
	const methodId = `${id}Method`;
	const deploymentId = `${id}Deployment`;
	const stageId = `${id}Stage`;

	const method: Record<string, unknown> = {
		Type: "AWS::ApiGateway::Method",
		Properties: {
			RestApiId: ref(id),
			ResourceId: getAtt(id, "RootResourceId"),
			HttpMethod: str(attributes.http_method) ?? "GET",
			AuthorizationType: "NONE",
		},
	};
	const lambdaRefs = idList(attributes.lambda_refs);
	if (lambdaRefs.length > 0) {
		(method.Properties as Record<string, unknown>).Integration = {
			Type: "AWS_PROXY",
			IntegrationHttpMethod: "POST",
			Uri: {
				"Fn::Join": [
					"",
					[
						"arn:aws:apigateway:",
						{ Ref: "AWS::Region" },
						":lambda:path/2015-03-31/functions/",
						getAtt(lambdaRefs[0] ?? "", "Arn"),
						"/invocations",
					],
				],
			},
		};
	}

	return [
		{
			id,
			block: {
				Type: "AWS::ApiGateway::RestApi",
				Properties: {
					Name: `api-${resource.name}`,
					EndpointConfiguration: { Types: ["REGIONAL"] },
				},
			},
		},
		{ id: methodId, block: method },
		{
			id: deploymentId,
			block: {
				Type: "AWS::ApiGateway::Deployment",
				Properties: { RestApiId: ref(id) },
				DependsOn: [methodId],
			},
		},
		{
			id: stageId,
			block: {
				Type: "AWS::ApiGateway::Stage",
				Properties: {
					StageName: str(attributes.stage_name) ?? "v1",
					RestApiId: ref(id),
					DeploymentId: ref(deploymentId),
				},
				DependsOn: [deploymentId],
			},
		},
	];
}

function resourceBlocks(resource: IRResource): ExportBlock[] {
	switch (resource.kind) {
		case "aws_instance":
			return writeEc2(resource);
		case "aws_s3_bucket":
			return writeS3(resource);
		case "aws_vpc":
			return writeVpc(resource);
		case "aws_subnet":
			return writeSubnet(resource);
		case "aws_security_group":
			return writeSecurityGroup(resource);
		case "aws_dynamodb_table":
			return writeDynamoDb(resource);
		case "aws_db_instance":
			return writeRds(resource);
		case "aws_internet_gateway":
			return writeInternetGateway(resource);
		case "aws_nat_gateway":
			return writeNatGateway(resource);
		case "aws_lb":
			return writeAlb(resource);
		case "aws_ecr_repository":
			return writeEcr(resource);
		case "aws_lambda_function":
			return writeLambda(resource);
		case "aws_ecs_cluster":
			return writeEcs(resource);
		case "aws_ebs_volume":
			return writeEbs(resource);
		case "aws_efs_file_system":
			return writeEfs(resource);
		case "aws_rds_cluster":
			return writeAurora(resource);
		case "aws_elasticache_cluster":
			return writeElasticache(resource);
		case "aws_iam_role":
			return writeIamRole(resource);
		case "aws_iam_policy":
			return writeIamPolicy(resource);
		case "aws_sqs_queue":
			return writeSqs(resource);
		case "aws_sns_topic":
			return writeSns(resource);
		case "aws_route53_zone":
			return writeRoute53Zone(resource);
		case "aws_route53_record":
			return writeRoute53Record(resource);
		case "aws_cloudwatch_log_group":
			return writeLogGroup(resource);
		case "aws_api_gateway_rest_api":
			return writeApiGateway(resource);
		default:
			return [];
	}
}

/**
 * Compiles an IR document into an AWS CloudFormation template (JSON string).
 * Emits one or more AWS:: resources per IR resource, wiring references and
 * DependsOn edges the same way the OpenTofu plan does.
 */
export function exportCloudFormation(document: IRDocument): string {
	const logicalById = new Map<string, string>();
	for (const resource of document.resources) {
		logicalById.set(resource.irId, logicalId(resource));
	}
	cfnLogicalIds = logicalById;

	const resources: Record<string, Record<string, unknown>> = {};
	for (const resource of document.resources) {
		const blocks = resourceBlocks(resource);
		const first = blocks[0];
		if (!first) continue;
		first.block.DependsOn = deps(resource, logicalById);
		for (const block of blocks) {
			resources[block.id] = block.block;
		}
	}

	const template: Record<string, unknown> = {
		AWSTemplateFormatVersion: "2010-09-09",
		Description:
			"CloudMan infrastructure graph export (best-effort CloudFormation mapping)",
		Resources: resources,
		Outputs: {
			StackName: { Value: { Ref: "AWS::StackName" } },
			Region: { Value: { Ref: "AWS::Region" } },
		},
	};

	return JSON.stringify(template, null, 2);
}
