import type { LucideIcon } from "lucide-react";
import {
	Activity,
	Box,
	Boxes,
	CloudCog,
	Container,
	Database,
	Globe,
	HardDrive,
	Layers,
	MessageSquare,
	Network,
	Radio,
	Route,
	Send,
	Server,
	Shield,
	ShieldCheck,
	Waypoints,
	Zap,
} from "lucide-react";

export type FieldType = "text" | "number" | "boolean" | "select" | "list";

export interface FieldDescriptor {
	key: string;
	label: string;
	type: FieldType;
	options?: string[];
	min?: number;
	max?: number;
	placeholder?: string;
	optional?: boolean;
	default?: unknown;
	/** For list fields: schema of one entry. */
	itemFields?: FieldDescriptor[];
}

export interface ResourceUiSpec {
	type: string;
	label: string;
	description: string;
	icon: LucideIcon;
	accent: string;
	idPrefix: string;
	fields: FieldDescriptor[];
}

export const RESOURCE_SPECS: Record<string, ResourceUiSpec> = {
	aws_ec2: {
		type: "aws_ec2",
		label: "EC2 Instance",
		description: "AWS virtual machine",
		icon: Server,
		accent: "#f97316",
		idPrefix: "ec2",
		fields: [
			{
				key: "instanceType",
				label: "Instance type",
				type: "select",
				options: ["t2.micro", "t3.micro", "t3.small", "t3.medium"],
				default: "t3.micro",
			},
			{
				key: "volumeSizeGb",
				label: "Root volume (GB)",
				type: "number",
				min: 8,
				max: 1024,
				default: 8,
			},
			{
				key: "ami",
				label: "AMI ID",
				type: "text",
				optional: true,
				placeholder: "auto: latest AL2023",
			},
			{ key: "keyPairName", label: "Key pair", type: "text", optional: true },
		],
	},
	aws_s3: {
		type: "aws_s3",
		label: "S3 Bucket",
		description: "Object storage bucket",
		icon: Database,
		accent: "#22c55e",
		idPrefix: "s3",
		fields: [
			{
				key: "bucketName",
				label: "Bucket name",
				type: "text",
				optional: true,
				placeholder: "auto-generated",
			},
			{
				key: "versioning",
				label: "Versioning",
				type: "boolean",
				default: false,
			},
			{
				key: "forceDestroy",
				label: "Force destroy on delete",
				type: "boolean",
				default: true,
			},
		],
	},
	aws_vpc: {
		type: "aws_vpc",
		label: "VPC",
		description: "Isolated virtual network",
		icon: Network,
		accent: "#38bdf8",
		idPrefix: "vpc",
		fields: [
			{
				key: "cidrBlock",
				label: "CIDR block",
				type: "text",
				default: "10.0.0.0/16",
				placeholder: "10.0.0.0/16",
			},
			{
				key: "enableDnsHostnames",
				label: "DNS hostnames",
				type: "boolean",
				default: true,
			},
		],
	},
	aws_subnet: {
		type: "aws_subnet",
		label: "Subnet",
		description: "Subnet inside a VPC",
		icon: Network,
		accent: "#818cf8",
		idPrefix: "subnet",
		fields: [
			{
				key: "cidrBlock",
				label: "CIDR block",
				type: "text",
				placeholder: "10.0.1.0/24",
			},
			{
				key: "availabilityZone",
				label: "Availability zone",
				type: "text",
				optional: true,
				placeholder: "auto: first AZ",
			},
		],
	},
	aws_security_group: {
		type: "aws_security_group",
		label: "Security Group",
		description: "Instance-level firewall rules",
		icon: Network,
		accent: "#f43f5e",
		idPrefix: "sg",
		fields: [
			{
				key: "description",
				label: "Description",
				type: "text",
				optional: true,
				placeholder: "Managed by CloudMan",
			},
			{
				key: "ingressRules",
				label: "Ingress rules",
				type: "list",
				itemFields: [
					{
						key: "fromPort",
						label: "From port",
						type: "number",
						min: 0,
						max: 65535,
						default: 443,
					},
					{
						key: "toPort",
						label: "To port",
						type: "number",
						min: 0,
						max: 65535,
						default: 443,
					},
					{
						key: "protocol",
						label: "Protocol",
						type: "select",
						options: ["tcp", "udp", "icmp"],
						default: "tcp",
					},
					{
						key: "cidrBlock",
						label: "Source CIDR",
						type: "text",
						default: "0.0.0.0/0",
					},
				],
			},
		],
	},
	aws_dynamodb_table: {
		type: "aws_dynamodb_table",
		label: "DynamoDB Table",
		description: "Serverless NoSQL key-value store",
		icon: Database,
		accent: "#eab308",
		idPrefix: "kv",
		fields: [
			{
				key: "hashKey",
				label: "Partition key",
				type: "text",
				default: "id",
			},
			{
				key: "hashKeyType",
				label: "Partition key type",
				type: "select",
				options: ["S", "N", "B"],
				default: "S",
			},
			{
				key: "rangeKey",
				label: "Sort key",
				type: "text",
				optional: true,
				placeholder: "none",
			},
			{
				key: "rangeKeyType",
				label: "Sort key type",
				type: "select",
				options: ["S", "N", "B"],
				default: "S",
			},
			{
				key: "billingMode",
				label: "Billing mode",
				type: "select",
				options: ["PAY_PER_REQUEST", "PROVISIONED"],
				default: "PAY_PER_REQUEST",
			},
		],
	},
	aws_rds: {
		type: "aws_rds",
		label: "RDS Database",
		description: "Managed relational database (Postgres/MySQL)",
		icon: Database,
		accent: "#a78bfa",
		idPrefix: "db",
		fields: [
			{
				key: "engine",
				label: "Engine",
				type: "select",
				options: ["postgres", "mysql"],
				default: "postgres",
			},
			{
				key: "instanceClass",
				label: "Instance class",
				type: "select",
				options: ["db.t3.micro", "db.t3.small", "db.t3.medium"],
				default: "db.t3.micro",
			},
			{
				key: "allocatedStorageGb",
				label: "Storage (GB)",
				type: "number",
				min: 20,
				max: 65536,
				default: 20,
			},
			{
				key: "dbName",
				label: "Database name",
				type: "text",
				default: "appdb",
			},
			{
				key: "publiclyAccessible",
				label: "Publicly accessible",
				type: "boolean",
				default: false,
			},
			{
				key: "skipFinalSnapshot",
				label: "Skip final snapshot",
				type: "boolean",
				default: true,
			},
		],
	},
	aws_internet_gateway: {
		type: "aws_internet_gateway",
		label: "Internet Gateway",
		description: "Public internet access for a VPC",
		icon: Globe,
		accent: "#0ea5e9",
		idPrefix: "ig",
		fields: [],
	},
	aws_nat_gateway: {
		type: "aws_nat_gateway",
		label: "NAT Gateway",
		description: "Outbound connectivity for private subnets",
		icon: Waypoints,
		accent: "#14b8a6",
		idPrefix: "nat",
		fields: [
			{
				key: "connectivityType",
				label: "Connectivity",
				type: "select",
				options: ["public", "private"],
				default: "public",
			},
		],
	},
	aws_alb: {
		type: "aws_alb",
		label: "Application Load Balancer",
		description: "Layer 7 traffic distribution to EC2 targets",
		icon: Route,
		accent: "#8b5cf6",
		idPrefix: "alb",
		fields: [
			{
				key: "scheme",
				label: "Scheme",
				type: "select",
				options: ["internet-facing", "internal"],
				default: "internet-facing",
			},
			{
				key: "listenerProtocol",
				label: "Listener protocol",
				type: "select",
				options: ["HTTP", "HTTPS"],
				default: "HTTP",
			},
			{
				key: "listenerPort",
				label: "Listener port",
				type: "number",
				min: 1,
				max: 65535,
				default: 80,
			},
			{
				key: "healthCheckPath",
				label: "Health check path",
				type: "text",
				default: "/",
			},
		],
	},
	aws_ecr: {
		type: "aws_ecr",
		label: "ECR Repository",
		description: "Docker container image registry",
		icon: Container,
		accent: "#64748b",
		idPrefix: "repo",
		fields: [
			{
				key: "tagMutability",
				label: "Tag mutability",
				type: "select",
				options: ["MUTABLE", "IMMUTABLE"],
				default: "MUTABLE",
			},
			{
				key: "scanOnPush",
				label: "Scan on push",
				type: "boolean",
				default: true,
			},
		],
	},
	aws_lambda: {
		type: "aws_lambda",
		label: "Lambda Function",
		description: "Serverless event-driven compute",
		icon: Zap,
		accent: "#f59e0b",
		idPrefix: "fn",
		fields: [
			{
				key: "codeSource",
				label: "Code source",
				type: "select",
				options: ["image", "zip"],
				default: "image",
			},
			{
				key: "runtime",
				label: "Runtime",
				type: "select",
				options: ["nodejs22.x", "nodejs20.x", "python3.13", "python3.12"],
				default: "nodejs22.x",
			},
			{
				key: "handler",
				label: "Handler",
				type: "text",
				default: "index.handler",
			},
			{
				key: "memoryMb",
				label: "Memory (MB)",
				type: "number",
				min: 128,
				max: 10240,
				default: 128,
			},
			{
				key: "timeoutSec",
				label: "Timeout (seconds)",
				type: "number",
				min: 1,
				max: 900,
				default: 3,
			},
			{
				key: "s3CodeBucket",
				label: "S3 code bucket (zip)",
				type: "text",
				optional: true,
			},
			{
				key: "s3CodeKey",
				label: "S3 code key (zip)",
				type: "text",
				optional: true,
			},
		],
	},
	aws_ecs: {
		type: "aws_ecs",
		label: "ECS Service",
		description: "Fargate container orchestration",
		icon: CloudCog,
		accent: "#06b6d4",
		idPrefix: "svc",
		fields: [
			{
				key: "cpu",
				label: "CPU",
				type: "select",
				options: ["0.25 vCPU", "0.5 vCPU", "1 vCPU", "2 vCPU", "4 vCPU"],
				default: "0.25 vCPU",
			},
			{
				key: "memory",
				label: "Memory",
				type: "select",
				options: ["0.5 GB", "1 GB", "2 GB", "4 GB", "8 GB", "16 GB"],
				default: "0.5 GB",
			},
			{
				key: "containerPort",
				label: "Container port",
				type: "number",
				min: 1,
				max: 65535,
				default: 80,
			},
			{
				key: "desiredCount",
				label: "Desired tasks",
				type: "number",
				min: 1,
				max: 100,
				default: 1,
			},
			{
				key: "imageTag",
				label: "Image tag",
				type: "text",
				default: "latest",
			},
			{
				key: "assignPublicIp",
				label: "Assign public IP",
				type: "boolean",
				default: false,
			},
		],
	},
	aws_ebs: {
		type: "aws_ebs",
		label: "EBS Volume",
		description: "Block storage attached to an EC2 instance",
		icon: HardDrive,
		accent: "#84cc16",
		idPrefix: "vol",
		fields: [
			{
				key: "sizeGb",
				label: "Size (GB)",
				type: "number",
				min: 1,
				max: 16384,
				default: 10,
			},
			{
				key: "type",
				label: "Volume type",
				type: "select",
				options: ["gp3", "gp2", "io1", "io2", "sc1", "st1", "standard"],
				default: "gp3",
			},
			{
				key: "iops",
				label: "IOPS (provisioned)",
				type: "number",
				min: 100,
				max: 64000,
				optional: true,
			},
			{
				key: "device",
				label: "Device",
				type: "text",
				default: "/dev/sdf",
			},
			{
				key: "encrypted",
				label: "Encrypted",
				type: "boolean",
				default: true,
			},
		],
	},
	aws_efs: {
		type: "aws_efs",
		label: "EFS File System",
		description: "Shared network file storage",
		icon: Box,
		accent: "#10b981",
		idPrefix: "fs",
		fields: [
			{
				key: "performanceMode",
				label: "Performance mode",
				type: "select",
				options: ["generalPurpose", "maxIO"],
				default: "generalPurpose",
			},
			{
				key: "throughputMode",
				label: "Throughput mode",
				type: "select",
				options: ["bursting", "elastic", "provisioned"],
				default: "elastic",
			},
			{
				key: "encrypted",
				label: "Encrypted",
				type: "boolean",
				default: true,
			},
		],
	},
	aws_aurora: {
		type: "aws_aurora",
		label: "Aurora Cluster",
		description: "Managed relational database cluster",
		icon: Database,
		accent: "#6366f1",
		idPrefix: "aurora",
		fields: [
			{
				key: "engine",
				label: "Engine",
				type: "select",
				options: ["aurora-postgresql", "aurora-mysql"],
				default: "aurora-postgresql",
			},
			{
				key: "engineVersion",
				label: "Engine version",
				type: "text",
				optional: true,
			},
			{
				key: "instanceClass",
				label: "Instance class",
				type: "select",
				options: [
					"db.t3.medium",
					"db.t4g.medium",
					"db.r5.large",
					"db.r6g.large",
				],
				default: "db.t4g.medium",
			},
			{
				key: "dbName",
				label: "Database name",
				type: "text",
				default: "appdb",
			},
			{
				key: "dbUsername",
				label: "Master username",
				type: "text",
				default: "cloudman_admin",
			},
		],
	},
	aws_elasticache: {
		type: "aws_elasticache",
		label: "ElastiCache",
		description: "Managed Redis or Memcached cache",
		icon: Zap,
		accent: "#ef4444",
		idPrefix: "cache",
		fields: [
			{
				key: "engine",
				label: "Engine",
				type: "select",
				options: ["redis", "memcached"],
				default: "redis",
			},
			{
				key: "nodeType",
				label: "Node type",
				type: "select",
				options: [
					"cache.t3.micro",
					"cache.t3.small",
					"cache.t3.medium",
					"cache.m7g.large",
				],
				default: "cache.t3.micro",
			},
			{
				key: "numCacheNodes",
				label: "Cache nodes",
				type: "number",
				min: 1,
				max: 20,
				default: 1,
			},
			{
				key: "port",
				label: "Port",
				type: "number",
				min: 1,
				max: 65535,
				optional: true,
			},
		],
	},
	aws_iam_role: {
		type: "aws_iam_role",
		label: "IAM Role",
		description: "Identity with an assume-role trust policy",
		icon: Shield,
		accent: "#94a3b8",
		idPrefix: "role",
		fields: [
			{
				key: "assumeService",
				label: "Assume service",
				type: "select",
				options: [
					"ec2",
					"lambda",
					"ecs-tasks",
					"apigateway",
					"eks",
					"events",
					"ssm",
				],
				default: "ec2",
			},
			{ key: "name", label: "Role name", type: "text", optional: true },
		],
	},
	aws_iam_policy: {
		type: "aws_iam_policy",
		label: "IAM Policy",
		description: "Permissions document attachable to a role",
		icon: ShieldCheck,
		accent: "#cbd5e1",
		idPrefix: "policy",
		fields: [
			{ key: "name", label: "Policy name", type: "text", optional: true },
		],
	},
	aws_sqs: {
		type: "aws_sqs",
		label: "SQS Queue",
		description: "Reliable message queue",
		icon: MessageSquare,
		accent: "#fbbf24",
		idPrefix: "queue",
		fields: [
			{
				key: "visibilityTimeoutSec",
				label: "Visibility timeout (s)",
				type: "number",
				min: 1,
				max: 43200,
				default: 30,
			},
			{
				key: "delaySeconds",
				label: "Delay (s)",
				type: "number",
				min: 0,
				max: 900,
				default: 0,
			},
			{
				key: "fifo",
				label: "FIFO queue",
				type: "boolean",
				default: false,
			},
		],
	},
	aws_sns: {
		type: "aws_sns",
		label: "SNS Topic",
		description: "Pub/sub notification topic",
		icon: Send,
		accent: "#f472b6",
		idPrefix: "topic",
		fields: [
			{
				key: "displayName",
				label: "Display name",
				type: "text",
				optional: true,
			},
		],
	},
	aws_route53_zone: {
		type: "aws_route53_zone",
		label: "Route 53 Zone",
		description: "DNS hosted zone",
		icon: Globe,
		accent: "#2dd4bf",
		idPrefix: "zone",
		fields: [
			{
				key: "zoneName",
				label: "Domain",
				type: "text",
				placeholder: "app.example.com",
			},
			{
				key: "privateZone",
				label: "Private zone",
				type: "boolean",
				default: false,
			},
		],
	},
	aws_route53_record: {
		type: "aws_route53_record",
		label: "Route 53 Record",
		description: "DNS record; aliases a wired ALB",
		icon: Radio,
		accent: "#22d3ee",
		idPrefix: "record",
		fields: [
			{ key: "recordName", label: "Name", type: "text", placeholder: "api" },
			{
				key: "recordType",
				label: "Type",
				type: "select",
				options: ["A", "AAAA", "CNAME", "TXT", "MX"],
				default: "A",
			},
			{
				key: "ttl",
				label: "TTL (seconds)",
				type: "number",
				min: 1,
				max: 86400,
				default: 300,
			},
		],
	},
	aws_cloudwatch_log_group: {
		type: "aws_cloudwatch_log_group",
		label: "Log Group",
		description: "CloudWatch log retention group",
		icon: Activity,
		accent: "#34d399",
		idPrefix: "log",
		fields: [
			{
				key: "retentionDays",
				label: "Retention (days)",
				type: "number",
				min: 1,
				max: 3653,
				default: 14,
			},
		],
	},
	aws_apigateway: {
		type: "aws_apigateway",
		label: "API Gateway",
		description: "REST API fronting wired Lambda functions",
		icon: Layers,
		accent: "#3b82f6",
		idPrefix: "api",
		fields: [
			{ key: "stageName", label: "Stage", type: "text", default: "v1" },
			{
				key: "routePath",
				label: "Resource path",
				type: "text",
				default: "{proxy+}",
			},
			{
				key: "httpMethod",
				label: "HTTP method",
				type: "select",
				options: ["ANY", "GET", "POST", "PUT", "DELETE", "PATCH"],
				default: "ANY",
			},
		],
	},
};

/** Extra palette entries shown but not yet compiled — kept honest by exclusion from specs. */
export const PALETTE_ITEMS = Object.values(RESOURCE_SPECS);

export const PLACEHOLDER_ICONS: Record<string, LucideIcon> = {
	network: Network,
	container: Container,
	box: Boxes,
};

export function defaultConfig(spec: ResourceUiSpec): Record<string, unknown> {
	const config: Record<string, unknown> = {};
	for (const field of spec.fields) {
		if (field.default !== undefined) config[field.key] = field.default;
	}
	return config;
}
