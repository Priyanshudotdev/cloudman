import type { LucideIcon } from "lucide-react";
import { Boxes, Container, Database, Network, Server } from "lucide-react";

export type FieldType = "text" | "number" | "boolean" | "select";

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
