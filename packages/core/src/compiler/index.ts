import type { IRDocument, IRResource } from "../ir/schema";
import { HclWriter, hclString, hclValue } from "./hcl";

export interface CompiledFile {
	path: string;
	contents: string;
}

export interface CompileOptions {
	/** Suffix mixed into auto-generated S3 bucket names for global uniqueness. */
	bucketNameSuffix?: string;
}

function tofuAddress(resource: IRResource): string {
	return `${resource.kind}.${resource.name}`;
}

function dependencyAddresses(
	resource: IRResource,
	addressById: Map<string, string>,
): string[] {
	return resource.dependsOn
		.map((id) => addressById.get(id))
		.filter((address): address is string => Boolean(address));
}

function writeTags(writer: HclWriter, label: string): void {
	writer.blank();
	writer.block("tags =", () => {
		writer.line(`Name      = ${hclString(label)}`);
		writer.line(`ManagedBy = ${hclString("cloudman")}`);
	});
}

const BASE_AMI_DATA_SOURCE = `data "aws_ami" "cloudman_base" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}`;

function writeEc2(
	writer: HclWriter,
	resource: IRResource,
	addressById: Map<string, string>,
): void {
	writer.block(`resource "aws_instance" "${resource.name}"`, () => {
		const ami = resource.attributes.ami;
		writer.line(
			`ami           = ${typeof ami === "string" ? hclString(ami) : "data.aws_ami.cloudman_base.id"}`,
		);
		writer.line(
			`instance_type = ${hclValue(resource.attributes.instance_type)}`,
		);

		const keyName = resource.attributes.key_name;
		if (typeof keyName === "string")
			writer.line(`key_name      = ${hclString(keyName)}`);

		const volumeSize = resource.attributes.volume_size_gb;
		if (typeof volumeSize === "number") {
			writer.blank();
			writer.block("root_block_device", () => {
				writer.line(`volume_size = ${volumeSize}`);
			});
		}

		writeTags(writer, resource.label ?? resource.name);

		const deps = dependencyAddresses(resource, addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});
}

function writeS3(
	writer: HclWriter,
	resource: IRResource,
	addressById: Map<string, string>,
	options: CompileOptions,
): void {
	const explicitBucket = resource.attributes.bucket;
	const bucketName =
		typeof explicitBucket === "string"
			? explicitBucket
			: `cloudman-${resource.name}-${options.bucketNameSuffix ?? "change-me"}`.slice(
					0,
					63,
				);

	writer.block(`resource "aws_s3_bucket" "${resource.name}"`, () => {
		writer.line(`bucket        = ${hclString(bucketName)}`);
		if (resource.attributes.force_destroy === true)
			writer.line("force_destroy = true");
		writeTags(writer, resource.label ?? resource.name);
		const deps = dependencyAddresses(resource, addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});

	if (resource.attributes.versioning === true) {
		writer.blank();
		writer.block(
			`resource "aws_s3_bucket_versioning" "${resource.name}"`,
			() => {
				writer.line(`bucket = ${tofuAddress(resource)}.id`);
				writer.blank();
				writer.block("versioning_configuration", () => {
					writer.line('status = "Enabled"');
				});
			},
		);
	}
}

export function compileIR(
	document: IRDocument,
	options: CompileOptions = {},
): CompiledFile[] {
	const addressById = new Map<string, string>();
	for (const resource of document.resources) {
		addressById.set(resource.irId, tofuAddress(resource));
	}

	const needsBaseAmi = document.resources.some(
		(r) => r.kind === "aws_instance" && !r.attributes.ami,
	);

	const main = new HclWriter();
	if (needsBaseAmi) {
		main.line(BASE_AMI_DATA_SOURCE);
		main.blank();
	}
	document.resources.forEach((resource, index) => {
		if (index > 0) main.blank();
		if (resource.kind === "aws_instance") {
			writeEc2(main, resource, addressById);
		} else if (resource.kind === "aws_s3_bucket") {
			writeS3(main, resource, addressById, options);
		}
	});

	const outputs = new HclWriter();
	document.resources.forEach((resource, index) => {
		if (index > 0) outputs.blank();
		const attrName =
			resource.kind === "aws_instance" ? "instance_id" : "bucket_id";
		outputs.block(`output "${resource.name}_${attrName}"`, () => {
			outputs.line(`value       = ${tofuAddress(resource)}.id`);
			outputs.line(
				`description = ${hclString(`${resource.label ?? resource.name} identifier`)}`,
			);
		});
	});

	return [
		{
			path: "versions.tf",
			contents: `terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = ${hclString(document.region)}
}
`,
		},
		{ path: "main.tf", contents: main.toString() },
		{ path: "outputs.tf", contents: outputs.toString() },
	];
}
