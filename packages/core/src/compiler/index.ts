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

/** Resolves an IR node id to its tofu `<kind>.<name>.id` reference address. */
function refAddress(addressById: Map<string, string>, irId: string): string {
	const address = addressById.get(irId);
	if (!address)
		throw new Error(`no compiled address for referenced node "${irId}"`);
	return `${address}.id`;
}

function outputAttrName(kind: string): string {
	switch (kind) {
		case "aws_instance":
			return "instance_id";
		case "aws_s3_bucket":
			return "bucket_id";
		case "aws_vpc":
			return "vpc_id";
		case "aws_subnet":
			return "subnet_id";
		case "aws_security_group":
			return "security_group_id";
		default:
			return "id";
	}
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

		const subnetRef = resource.attributes.subnet_ref;
		if (typeof subnetRef === "string") {
			writer.line(`subnet_id     = ${refAddress(addressById, subnetRef)}`);
		}

		const sgRefs = resource.attributes.security_group_refs;
		if (
			Array.isArray(sgRefs) &&
			sgRefs.every((ref): ref is string => typeof ref === "string") &&
			sgRefs.length > 0
		) {
			writer.line(
				`vpc_security_group_ids = [${sgRefs.map((ref) => refAddress(addressById, ref)).join(", ")}]`,
			);
		}

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

function writeVpc(
	writer: HclWriter,
	resource: IRResource,
	addressById: Map<string, string>,
): void {
	writer.block(`resource "aws_vpc" "${resource.name}"`, () => {
		writer.line(
			`cidr_block           = ${hclValue(resource.attributes.cidr_block)}`,
		);
		if (resource.attributes.enable_dns_hostnames !== undefined)
			writer.line(
				`enable_dns_hostnames = ${resource.attributes.enable_dns_hostnames === true}`,
			);
		writeTags(writer, resource.label ?? resource.name);
		const deps = dependencyAddresses(resource, addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});
}

function writeSubnet(
	writer: HclWriter,
	resource: IRResource,
	addressById: Map<string, string>,
): void {
	writer.block(`resource "aws_subnet" "${resource.name}"`, () => {
		const vpcRef = resource.attributes.vpc_ref;
		if (typeof vpcRef === "string") {
			writer.line(`vpc_id     = ${refAddress(addressById, vpcRef)}`);
		}
		writer.line(`cidr_block = ${hclValue(resource.attributes.cidr_block)}`);

		const az = resource.attributes.availability_zone;
		if (typeof az === "string")
			writer.line(`availability_zone = ${hclString(az)}`);

		writeTags(writer, resource.label ?? resource.name);
		const deps = dependencyAddresses(resource, addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});
}

function writeSecurityGroup(
	writer: HclWriter,
	resource: IRResource,
	addressById: Map<string, string>,
): void {
	writer.block(`resource "aws_security_group" "${resource.name}"`, () => {
		writer.line(`name        = ${hclString(`cloudman-${resource.name}`)}`);
		const description = resource.attributes.description;
		writer.line(
			`description = ${hclString(typeof description === "string" ? description : "Managed by CloudMan")}`,
		);

		const vpcRef = resource.attributes.vpc_ref;
		if (typeof vpcRef === "string") {
			writer.line(`vpc_id      = ${refAddress(addressById, vpcRef)}`);
		}

		const ingressRules = resource.attributes.ingress_rules;
		if (
			Array.isArray(ingressRules) &&
			ingressRules.every(
				(rule): rule is Record<string, unknown> =>
					typeof rule === "object" && rule !== null,
			) &&
			ingressRules.length > 0
		) {
			for (const rule of ingressRules) {
				writer.blank();
				writer.block("ingress", () => {
					writer.line(`from_port   = ${hclValue(rule.from_port)}`);
					writer.line(`to_port     = ${hclValue(rule.to_port)}`);
					writer.line(`protocol    = ${hclValue(rule.protocol)}`);
					const cidr =
						typeof rule.cidr_block === "string" ? rule.cidr_block : "0.0.0.0/0";
					writer.line(`cidr_blocks = [${hclString(cidr)}]`);
				});
			}
		}

		writer.blank();
		writer.block("egress", () => {
			writer.line("from_port   = 0");
			writer.line("to_port     = 0");
			writer.line('protocol    = "-1"');
			writer.line('cidr_blocks = ["0.0.0.0/0"]');
		});

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
		} else if (resource.kind === "aws_vpc") {
			writeVpc(main, resource, addressById);
		} else if (resource.kind === "aws_subnet") {
			writeSubnet(main, resource, addressById);
		} else if (resource.kind === "aws_security_group") {
			writeSecurityGroup(main, resource, addressById);
		}
	});

	const outputs = new HclWriter();
	document.resources.forEach((resource, index) => {
		if (index > 0) outputs.blank();
		outputs.block(
			`output "${resource.name}_${outputAttrName(resource.kind)}"`,
			() => {
				outputs.line(`value       = ${tofuAddress(resource)}.id`);
				outputs.line(
					`description = ${hclString(`${resource.label ?? resource.name} identifier`)}`,
				);
			},
		);
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
