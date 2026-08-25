import type { LucideIcon } from "lucide-react";
import { Boxes, Container, Database, Network, Server } from "lucide-react";

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
