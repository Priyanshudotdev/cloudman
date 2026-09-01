import type { IRDocument, IRResource } from "../ir/schema";
import { HclWriter, hclInterpString, hclString, hclValue } from "./hcl";

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

/**
 * Resolves an IR node id to a non-`id` attribute, e.g. `aws_lb.x.dns_name`.
 * Used whenever a reference is not the resource's primary `.id`.
 */
function refAttr(
	addressById: Map<string, string>,
	irId: string,
	attr: string,
): string {
	const address = addressById.get(irId);
	if (!address)
		throw new Error(`no compiled address for referenced node "${irId}"`);
	return `${address}.${attr}`;
}

function writeTags(writer: HclWriter, label: string): void {
	writer.blank();
	writer.block("tags =", () => {
		writer.line(`Name      = ${hclString(label)}`);
		writer.line(`ManagedBy = ${hclString("cloudman")}`);
	});
}

/** Emits pre-indented block content lines at the writer's current depth. */
function emitLines(writer: HclWriter, lines: string[]): void {
	for (const line of lines) writer.line(line);
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
		case "aws_dynamodb_table":
			return "table_id";
		case "aws_db_instance":
			return "db_id";
		default:
			return "id";
	}
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

function writeDynamoDb(
	writer: HclWriter,
	resource: IRResource,
	addressById: Map<string, string>,
	options: CompileOptions,
): void {
	const suffix = options.bucketNameSuffix ?? "change-me";
	const tableName = `cloudman-${resource.name}-${suffix}`.slice(0, 255);

	writer.block(`resource "aws_dynamodb_table" "${resource.name}"`, () => {
		writer.line(`name         = ${hclString(tableName)}`);
		writer.line(`hash_key     = ${hclValue(resource.attributes.hash_key)}`);
		if (resource.attributes.billing_mode === "PROVISIONED") {
			writer.line('billing_mode = "PROVISIONED"');
			writer.line("read_capacity  = 5");
			writer.line("write_capacity = 5");
		} else {
			writer.line('billing_mode = "PAY_PER_REQUEST"');
		}

		const hashType =
			typeof resource.attributes.hash_key_type === "string"
				? resource.attributes.hash_key_type
				: "S";
		writer.blank();
		writer.block("attribute", () => {
			writer.line(`name = ${hclValue(resource.attributes.hash_key)}`);
			writer.line(`type = ${hclString(hashType)}`);
		});

		if (
			typeof resource.attributes.range_key === "string" &&
			resource.attributes.range_key.length > 0
		) {
			const rangeKeyName: string = resource.attributes.range_key;
			const rangeType =
				typeof resource.attributes.range_key_type === "string"
					? resource.attributes.range_key_type
					: "S";
			writer.blank();
			writer.block("attribute", () => {
				writer.line(`name = ${hclString(rangeKeyName)}`);
				writer.line(`type = ${hclString(rangeType)}`);
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

/**
 * Emits the db instance plus a synthesized aws_db_subnet_group built from
 * every subnet the consumer wired to it — users never manage the group node.
 */
function writeRds(
	writer: HclWriter,
	resource: IRResource,
	addressById: Map<string, string>,
	options: CompileOptions,
): void {
	const suffix = options.bucketNameSuffix ?? "change-me";

	const subnetRefs = resource.attributes.subnet_refs;
	const subnetIds =
		Array.isArray(subnetRefs) &&
		subnetRefs.every((ref): ref is string => typeof ref === "string")
			? subnetRefs.map((ref) => refAddress(addressById, ref))
			: [];
	if (subnetIds.length > 0) {
		writer.block(
			`resource "aws_db_subnet_group" "${resource.name}-subnets"`,
			() => {
				writer.line(
					`name       = ${hclString(`cloudman-${resource.name}-${suffix}`.slice(0, 255))}`,
				);
				writer.line(`subnet_ids = [${subnetIds.join(", ")}]`);
				writeTags(writer, `${resource.label ?? resource.name} subnets`);
			},
		);
		writer.blank();
	}

	writer.block(`resource "aws_db_instance" "${resource.name}"`, () => {
		writer.line(
			`identifier     = ${hclString(`cloudman-${resource.name}-${suffix}`.slice(0, 63))}`,
		);
		writer.line(`engine         = ${hclValue(resource.attributes.engine)}`);
		const engineVersion = resource.attributes.engine_version;
		if (typeof engineVersion === "string")
			writer.line(`engine_version = ${hclString(engineVersion)}`);
		writer.line(
			`instance_class = ${hclValue(resource.attributes.instance_class)}`,
		);
		writer.line(
			`allocated_storage = ${hclValue(resource.attributes.allocated_storage_gb)}`,
		);
		writer.line(`db_name        = ${hclValue(resource.attributes.db_name)}`);
		writer.line(`username       = ${hclValue(resource.attributes.username)}`);
		writer.line("manage_master_user_password = true");
		if (typeof resource.attributes.publicly_accessible === "boolean")
			writer.line(
				`publicly_accessible = ${resource.attributes.publicly_accessible}`,
			);

		if (subnetIds.length > 0) {
			writer.line(
				`db_subnet_group_name = aws_db_subnet_group.${resource.name}-subnets.name`,
			);
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

		if (resource.attributes.skip_final_snapshot !== false) {
			writer.line("skip_final_snapshot = true");
		} else {
			writer.line("skip_final_snapshot = false");
			writer.line(
				`final_snapshot_identifier = ${hclString(`cloudman-${resource.name}-${suffix}-final`)}`,
			);
		}

		writeTags(writer, resource.label ?? resource.name);
		const deps = dependencyAddresses(resource, addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});
}

interface CompileContext {
	addressById: Map<string, string>;
	options: CompileOptions;
	region: string;
	/** zone_name attribute of each route53 zone, keyed by irId. */
	zoneNames: Map<string, string>;
}

function writeInternetGateway(
	writer: HclWriter,
	resource: IRResource,
	ctx: CompileContext,
): void {
	writer.block(`resource "aws_internet_gateway" "${resource.name}"`, () => {
		const vpcRef = resource.attributes.vpc_ref;
		if (typeof vpcRef === "string") {
			writer.line(`vpc_id = ${refAddress(ctx.addressById, vpcRef)}`);
		}
		writeTags(writer, resource.label ?? resource.name);
		const deps = dependencyAddresses(resource, ctx.addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});
}

function writeNatGateway(
	writer: HclWriter,
	resource: IRResource,
	ctx: CompileContext,
): void {
	const connectivity =
		typeof resource.attributes.connectivity_type === "string"
			? resource.attributes.connectivity_type
			: "public";

	if (connectivity === "public") {
		writer.block(`resource "aws_eip" "${resource.name}-eip"`, () => {
			writer.line('domain = "vpc"');
			writeTags(writer, `${resource.label ?? resource.name} eip`);
		});
		writer.blank();
	}

	writer.block(`resource "aws_nat_gateway" "${resource.name}"`, () => {
		const subnetRef = resource.attributes.subnet_ref;
		if (typeof subnetRef === "string") {
			writer.line(`subnet_id = ${refAddress(ctx.addressById, subnetRef)}`);
		}
		writer.line(`connectivity_type = ${hclString(connectivity)}`);
		if (connectivity === "public") {
			writer.line(`allocation_id = aws_eip.${resource.name}-eip.id`);
		}
		writeTags(writer, resource.label ?? resource.name);
		const deps = dependencyAddresses(resource, ctx.addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});
}

function writeAlb(
	writer: HclWriter,
	resource: IRResource,
	ctx: CompileContext,
): void {
	const suffix = ctx.options.bucketNameSuffix ?? "change-me";

	writer.block(`resource "aws_lb" "${resource.name}"`, () => {
		writer.line(
			`name               = ${hclString(`cloudman-${resource.name}-${suffix}`.slice(0, 32))}`,
		);
		writer.line('load_balancer_type = "application"');
		if (typeof resource.attributes.internal === "boolean") {
			writer.line(`internal           = ${resource.attributes.internal}`);
		}

		const subnetRefs = resource.attributes.subnet_refs;
		if (
			Array.isArray(subnetRefs) &&
			subnetRefs.every((ref): ref is string => typeof ref === "string") &&
			subnetRefs.length > 0
		) {
			writer.line(
				`subnets = [${subnetRefs.map((ref) => refAddress(ctx.addressById, ref)).join(", ")}]`,
			);
		}

		const sgRefs = resource.attributes.security_group_refs;
		if (
			Array.isArray(sgRefs) &&
			sgRefs.every((ref): ref is string => typeof ref === "string") &&
			sgRefs.length > 0
		) {
			writer.line(
				`security_groups = [${sgRefs.map((ref) => refAddress(ctx.addressById, ref)).join(", ")}]`,
			);
		}

		writeTags(writer, resource.label ?? resource.name);
		const deps = dependencyAddresses(resource, ctx.addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});
	writer.blank();

	const tgName = `${resource.name}-tg`;
	writer.block(`resource "aws_lb_target_group" "${tgName}"`, () => {
		writer.line(
			`name     = ${hclString(`cloudman-${tgName}-${suffix}`.slice(0, 32))}`,
		);
		const port = resource.attributes.listener_port;
		writer.line(`port     = ${typeof port === "number" ? port : 80}`);
		const protocol = resource.attributes.listener_protocol;
		writer.line(
			`protocol = ${hclString(typeof protocol === "string" ? protocol : "HTTP")}`,
		);
		writer.line('target_type = "instance"');
		const vpcRef = resource.attributes.vpc_ref;
		if (typeof vpcRef === "string") {
			writer.line(`vpc_id   = ${refAddress(ctx.addressById, vpcRef)}`);
		}
		writer.blank();
		writer.block("health_check", () => {
			const path = resource.attributes.health_check_path;
			writer.line(`path = ${hclString(typeof path === "string" ? path : "/")}`);
		});
		writeTags(writer, `${resource.label ?? resource.name} target group`);
		const deps = dependencyAddresses(resource, ctx.addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});
	writer.blank();

	const listenerName = `${resource.name}-listener`;
	writer.block(`resource "aws_lb_listener" "${listenerName}"`, () => {
		writer.line(`load_balancer_arn = aws_lb.${resource.name}.arn`);
		writer.line(
			`port = ${typeof resource.attributes.listener_port === "number" ? resource.attributes.listener_port : 80}`,
		);
		writer.line(
			`protocol = ${hclString(typeof resource.attributes.listener_protocol === "string" ? resource.attributes.listener_protocol : "HTTP")}`,
		);
		writer.blank();
		writer.block("default_action", () => {
			writer.line('type             = "forward"');
			writer.line(`target_group_arn = aws_lb_target_group.${tgName}.arn`);
		});
		writeTags(writer, `${resource.label ?? resource.name} listener`);
	});
	writer.blank();

	const targetRefs = resource.attributes.target_refs;
	if (
		Array.isArray(targetRefs) &&
		targetRefs.every((ref): ref is string => typeof ref === "string") &&
		targetRefs.length > 0
	) {
		targetRefs.forEach((target, index) => {
			writer.block(
				`resource "aws_lb_target_group_attachment" "${resource.name}-target-${index + 1}"`,
				() => {
					writer.line(`target_group_arn = aws_lb_target_group.${tgName}.arn`);
					writer.line(
						`target_id        = ${refAddress(ctx.addressById, target)}`,
					);
				},
			);
			writer.blank();
		});
	}
}

function writeEcr(
	writer: HclWriter,
	resource: IRResource,
	ctx: CompileContext,
): void {
	const suffix = ctx.options.bucketNameSuffix ?? "change-me";
	const repoName = `cloudman-${resource.name}-${suffix}`.slice(0, 255);

	writer.block(`resource "aws_ecr_repository" "${resource.name}"`, () => {
		writer.line(`name                 = ${hclString(repoName)}`);
		writer.line(
			`image_tag_mutability = ${hclValue(resource.attributes.image_tag_mutability ?? "MUTABLE")}`,
		);
		writer.blank();
		writer.block("image_scanning_configuration", () => {
			writer.line(
				`scan_on_push = ${resource.attributes.scan_on_push === true}`,
			);
		});
		writeTags(writer, resource.label ?? resource.name);
		const deps = dependencyAddresses(resource, ctx.addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});
}

function writeLambda(
	writer: HclWriter,
	resource: IRResource,
	ctx: CompileContext,
): void {
	const suffix = ctx.options.bucketNameSuffix ?? "change-me";
	const fnName = `cloudman-${resource.name}-${suffix}`.slice(0, 64);
	const codeSource =
		typeof resource.attributes.code_source === "string"
			? resource.attributes.code_source
			: "image";

	writer.block(`resource "aws_lambda_function" "${resource.name}"`, () => {
		writer.line(`function_name = ${hclString(fnName)}`);
		const roleRef = resource.attributes.iam_role_ref;
		if (typeof roleRef === "string") {
			writer.line(
				`role          = ${refAttr(ctx.addressById, roleRef, "arn")}`,
			);
		}
		writer.line(
			`memory_size   = ${typeof resource.attributes.memory_size === "number" ? resource.attributes.memory_size : 128}`,
		);
		writer.line(
			`timeout       = ${typeof resource.attributes.timeout === "number" ? resource.attributes.timeout : 3}`,
		);

		if (codeSource === "zip") {
			writer.line(
				`runtime = ${hclString(typeof resource.attributes.runtime === "string" ? resource.attributes.runtime : "nodejs22.x")}`,
			);
			writer.line(
				`handler = ${hclString(typeof resource.attributes.handler === "string" ? resource.attributes.handler : "index.handler")}`,
			);
			const s3Bucket = resource.attributes.s3_bucket;
			const s3Key = resource.attributes.s3_key;
			if (typeof s3Bucket === "string") {
				writer.line(`s3_bucket = ${hclString(s3Bucket)}`);
			}
			if (typeof s3Key === "string") {
				writer.line(`s3_key    = ${hclString(s3Key)}`);
			}
		} else {
			const repositoryRefs = resource.attributes.repository_refs;
			const repo = Array.isArray(repositoryRefs)
				? repositoryRefs.find((ref): ref is string => typeof ref === "string")
				: undefined;
			if (repo) {
				const imageUri = `\${${refAttr(ctx.addressById, repo, "repository_url")}}:latest`;
				writer.line(`image_uri = ${hclInterpString(imageUri)}`);
			}
		}

		const lambdaSubnets =
			Array.isArray(resource.attributes.subnet_refs) &&
			resource.attributes.subnet_refs.every(
				(ref): ref is string => typeof ref === "string",
			)
				? resource.attributes.subnet_refs
				: [];
		const lambdaSgs =
			Array.isArray(resource.attributes.security_group_refs) &&
			resource.attributes.security_group_refs.every(
				(ref): ref is string => typeof ref === "string",
			)
				? resource.attributes.security_group_refs
				: [];
		if (lambdaSubnets.length > 0) {
			writer.blank();
			writer.block("vpc_config", () => {
				writer.line(
					`subnet_ids         = [${lambdaSubnets.map((ref) => refAddress(ctx.addressById, ref)).join(", ")}]`,
				);
				if (lambdaSgs.length > 0) {
					writer.line(
						`security_group_ids = [${lambdaSgs.map((ref) => refAddress(ctx.addressById, ref)).join(", ")}]`,
					);
				}
			});
		}

		writer.blank();
		writer.block("logging_config", () => {
			writer.line('log_format = "JSON"');
		});

		writeTags(writer, resource.label ?? resource.name);
		const deps = dependencyAddresses(resource, ctx.addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});
}

const ECS_CPU_VALUES: Record<string, string> = {
	"0.25 vCPU": "256",
	"0.5 vCPU": "512",
	"1 vCPU": "1024",
	"2 vCPU": "2048",
	"4 vCPU": "4096",
};

const ECS_MEMORY_VALUES: Record<string, string> = {
	"0.5 GB": "512",
	"1 GB": "1024",
	"2 GB": "2048",
	"4 GB": "4096",
	"8 GB": "8192",
	"16 GB": "16384",
};

function writeEcs(
	writer: HclWriter,
	resource: IRResource,
	ctx: CompileContext,
): void {
	const suffix = ctx.options.bucketNameSuffix ?? "change-me";
	const base = resource.name;
	const cpu = hclString(
		ECS_CPU_VALUES[
			typeof resource.attributes.cpu === "string"
				? resource.attributes.cpu
				: "0.25 vCPU"
		] ?? "256",
	);
	const memory = hclString(
		ECS_MEMORY_VALUES[
			typeof resource.attributes.memory === "string"
				? resource.attributes.memory
				: "0.5 GB"
		] ?? "512",
	);
	const containerPort =
		typeof resource.attributes.container_port === "number"
			? resource.attributes.container_port
			: 80;

	writer.block(`resource "aws_ecs_cluster" "${resource.name}"`, () => {
		writer.line(
			`name = ${hclString(`cloudman-${base}-${suffix}`.slice(0, 255))}`,
		);
		writeTags(writer, `${resource.label ?? resource.name} cluster`);
	});
	writer.blank();

	const imageOverride =
		typeof resource.attributes.image === "string"
			? resource.attributes.image
			: undefined;
	const repositoryRefs =
		Array.isArray(resource.attributes.repository_refs) &&
		resource.attributes.repository_refs.every(
			(ref): ref is string => typeof ref === "string",
		)
			? resource.attributes.repository_refs
			: [];
	const imageTag =
		typeof resource.attributes.image_tag === "string"
			? resource.attributes.image_tag
			: "latest";

	writer.block(
		`resource "aws_ecs_task_definition" "${resource.name}-task"`,
		() => {
			writer.line(
				`family = ${hclString(`cloudman-${base}-${suffix}`.slice(0, 255))}`,
			);
			writer.line('network_mode             = "awsvpc"');
			writer.line('requires_compatibilities = ["FARGATE"]');
			writer.line(`cpu                      = ${cpu}`);
			writer.line(`memory                   = ${memory}`);
			const roleRef = resource.attributes.iam_role_ref;
			if (typeof roleRef === "string") {
				writer.line(
					`execution_role_arn       = ${refAttr(ctx.addressById, roleRef, "arn")}`,
				);
			}

			const image =
				imageOverride ??
				(repositoryRefs[0]
					? `\${${refAttr(ctx.addressById, repositoryRefs[0], "repository_url")}}:${imageTag}`
					: "nginx:latest");

			const containerLines = [
				"container_definitions = jsonencode([",
				"  {",
				`    name      = ${hclString(resource.name)}`,
				`    image     = ${hclString(image)}`,
				"    essential = true",
				"    portMappings = [",
				"      {",
				`        containerPort = ${containerPort}`,
				'        protocol      = "tcp"',
				"      }",
				"    ]",
				"    logConfiguration = {",
				'      logDriver = "awslogs"',
				"      options = {",
				`        awslogs-group         = ${hclString(`/ecs/cloudman-${base}`)}`,
				`        awslogs-region        = ${hclString(ctx.region)}`,
				'        awslogs-stream-prefix = "ecs"',
				"      }",
				"    }",
				"  }",
				"])",
			];
			emitLines(writer, containerLines);

			writeTags(writer, `${resource.label ?? resource.name} task`);
			const deps = dependencyAddresses(resource, ctx.addressById);
			if (deps.length > 0) {
				writer.blank();
				writer.line(`depends_on = [${deps.join(", ")}]`);
			}
		},
	);
	writer.blank();

	writer.block(`resource "aws_ecs_service" "${resource.name}-service"`, () => {
		writer.line(
			`name            = ${hclString(`cloudman-${base}-${suffix}-svc`.slice(0, 255))}`,
		);
		writer.line(
			`cluster         = aws_ecs_cluster.${resource.name}.id`,
		);
		writer.line(
			`task_definition = aws_ecs_task_definition.${resource.name}-task.arn`,
		);
		writer.line(
			`desired_count   = ${typeof resource.attributes.desired_count === "number" ? resource.attributes.desired_count : 1}`,
		);
		writer.line('launch_type     = "FARGATE"');
		writer.blank();
		writer.block("network_configuration", () => {
			const subnetRefs =
				Array.isArray(resource.attributes.subnet_refs) &&
				resource.attributes.subnet_refs.every(
					(ref): ref is string => typeof ref === "string",
				)
					? resource.attributes.subnet_refs
					: [];
			writer.line(
				`subnets          = [${subnetRefs.map((ref) => refAddress(ctx.addressById, ref)).join(", ")}]`,
			);
			const sgRefs =
				Array.isArray(resource.attributes.security_group_refs) &&
				resource.attributes.security_group_refs.every(
					(ref): ref is string => typeof ref === "string",
				)
					? resource.attributes.security_group_refs
					: [];
			if (sgRefs.length > 0) {
				writer.line(
					`security_groups  = [${sgRefs.map((ref) => refAddress(ctx.addressById, ref)).join(", ")}]`,
				);
			}
			writer.line(
				`assign_public_ip = ${resource.attributes.assign_public_ip === true}`,
			);
		});
		writeTags(writer, `${resource.label ?? resource.name} service`);
		const deps = dependencyAddresses(resource, ctx.addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});
}

function writeEbs(
	writer: HclWriter,
	resource: IRResource,
	ctx: CompileContext,
): void {
	writer.block(`resource "aws_ebs_volume" "${resource.name}"`, () => {
		const instanceRef = resource.attributes.instance_ref;
		if (typeof instanceRef === "string") {
			writer.line(
				`availability_zone = ${refAttr(ctx.addressById, instanceRef, "availability_zone")}`,
			);
		}
		writer.line(
			`size              = ${typeof resource.attributes.size_gb === "number" ? resource.attributes.size_gb : 10}`,
		);
		writer.line(
			`type              = ${hclString(typeof resource.attributes.volume_type === "string" ? resource.attributes.volume_type : "gp3")}`,
		);
		if (typeof resource.attributes.iops === "number") {
			writer.line(`iops = ${resource.attributes.iops}`);
		}
		writer.line(`encrypted = ${resource.attributes.encrypted !== false}`);
		writeTags(writer, resource.label ?? resource.name);
		const deps = dependencyAddresses(resource, ctx.addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});
	writer.blank();

	writer.block(
		`resource "aws_volume_attachment" "${resource.name}-attach"`,
		() => {
			writer.line(
				`device_name = ${hclString(typeof resource.attributes.device === "string" ? resource.attributes.device : "/dev/sdf")}`,
			);
			writer.line(`volume_id   = aws_ebs_volume.${resource.name}.id`);
			const instanceRef = resource.attributes.instance_ref;
			if (typeof instanceRef === "string") {
				writer.line(
					`instance_id = ${refAddress(ctx.addressById, instanceRef)}`,
				);
			}
			writer.blank();
			writer.line(`depends_on = [aws_ebs_volume.${resource.name}]`);
		},
	);
}

function writeEfs(
	writer: HclWriter,
	resource: IRResource,
	ctx: CompileContext,
): void {
	writer.block(`resource "aws_efs_file_system" "${resource.name}"`, () => {
		writer.line(
			`performance_mode = ${hclString(typeof resource.attributes.performance_mode === "string" ? resource.attributes.performance_mode : "generalPurpose")}`,
		);
		writer.line(
			`throughput_mode  = ${hclString(typeof resource.attributes.throughput_mode === "string" ? resource.attributes.throughput_mode : "elastic")}`,
		);
		writer.line(
			`encrypted        = ${resource.attributes.encrypted !== false}`,
		);
		writeTags(writer, resource.label ?? resource.name);
		const deps = dependencyAddresses(resource, ctx.addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});

	const subnetRefs =
		Array.isArray(resource.attributes.subnet_refs) &&
		resource.attributes.subnet_refs.every(
			(ref): ref is string => typeof ref === "string",
		)
			? resource.attributes.subnet_refs
			: [];
	const sgRefs =
		Array.isArray(resource.attributes.security_group_refs) &&
		resource.attributes.security_group_refs.every(
			(ref): ref is string => typeof ref === "string",
		)
			? resource.attributes.security_group_refs
			: [];
	subnetRefs.forEach((subnet, index) => {
		writer.blank();
		writer.block(
			`resource "aws_efs_mount_target" "${resource.name}-mt-${index + 1}"`,
			() => {
				writer.line(
					`file_system_id  = aws_efs_file_system.${resource.name}.id`,
				);
				writer.line(`subnet_id       = ${refAddress(ctx.addressById, subnet)}`);
				if (sgRefs.length > 0) {
					writer.line(
						`security_groups = [${sgRefs.map((ref) => refAddress(ctx.addressById, ref)).join(", ")}]`,
					);
				}
			},
		);
	});
}

function writeAurora(
	writer: HclWriter,
	resource: IRResource,
	ctx: CompileContext,
): void {
	const suffix = ctx.options.bucketNameSuffix ?? "change-me";
	const base = `cloudman-aurora-${resource.name}-${suffix}`;

	const subnetRefs =
		Array.isArray(resource.attributes.subnet_refs) &&
		resource.attributes.subnet_refs.every(
			(ref): ref is string => typeof ref === "string",
		)
			? resource.attributes.subnet_refs
			: [];
	if (subnetRefs.length > 0) {
		writer.block(
			`resource "aws_rds_subnet_group" "${resource.name}-subnets"`,
			() => {
				writer.line(
					`name       = ${hclString(`${base}-${suffix}`.slice(0, 255))}`,
				);
				writer.line(
					`subnet_ids = [${subnetRefs.map((ref) => refAddress(ctx.addressById, ref)).join(", ")}]`,
				);
				writeTags(writer, `${resource.label ?? resource.name} subnets`);
			},
		);
		writer.blank();
	}

	writer.block(`resource "aws_rds_cluster" "${resource.name}"`, () => {
		writer.line(
			`cluster_identifier = ${hclString(`${base}-${suffix}`.slice(0, 63))}`,
		);
		writer.line(
			`engine             = ${hclString(typeof resource.attributes.engine === "string" ? resource.attributes.engine : "aurora-postgresql")}`,
		);
		if (typeof resource.attributes.engine_version === "string") {
			writer.line(
				`engine_version     = ${hclString(resource.attributes.engine_version)}`,
			);
		}
		writer.line(
			`database_name      = ${hclString(typeof resource.attributes.db_name === "string" ? resource.attributes.db_name : "appdb")}`,
		);
		writer.line(
			`master_username    = ${hclString(typeof resource.attributes.db_username === "string" ? resource.attributes.db_username : "cloudman_admin")}`,
		);
		writer.line("manage_master_user_password = true");
		if (subnetRefs.length > 0) {
			writer.line(
				`db_subnet_group_name   = aws_rds_subnet_group.${resource.name}-subnets.name`,
			);
		}
		const sgRefs =
			Array.isArray(resource.attributes.security_group_refs) &&
			resource.attributes.security_group_refs.every(
				(ref): ref is string => typeof ref === "string",
			)
				? resource.attributes.security_group_refs
				: [];
		if (sgRefs.length > 0) {
			writer.line(
				`vpc_security_group_ids = [${sgRefs.map((ref) => refAddress(ctx.addressById, ref)).join(", ")}]`,
			);
		}
		writer.line("skip_final_snapshot = true");
		writeTags(writer, resource.label ?? resource.name);
		const deps = dependencyAddresses(resource, ctx.addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});
	writer.blank();

	writer.block(
		`resource "aws_rds_cluster_instance" "${resource.name}-instance"`,
		() => {
			writer.line(
				`identifier         = ${hclString(`${base}-instance-${suffix}`.slice(0, 63))}`,
			);
			writer.line(`cluster_identifier = aws_rds_cluster.${resource.name}.id`);
			writer.line(
				`instance_class     = ${hclString(typeof resource.attributes.instance_class === "string" ? resource.attributes.instance_class : "db.t4g.medium")}`,
			);
			writer.line(
				`engine             = ${hclString(typeof resource.attributes.engine === "string" ? resource.attributes.engine : "aurora-postgresql")}`,
			);
			writeTags(writer, `${resource.label ?? resource.name} instance`);
		},
	);
}

function writeElasticache(
	writer: HclWriter,
	resource: IRResource,
	ctx: CompileContext,
): void {
	const suffix = ctx.options.bucketNameSuffix ?? "change-me";
	const base = resource.name;

	const subnetRefs =
		Array.isArray(resource.attributes.subnet_refs) &&
		resource.attributes.subnet_refs.every(
			(ref): ref is string => typeof ref === "string",
		)
			? resource.attributes.subnet_refs
			: [];
	if (subnetRefs.length > 0) {
		writer.block(
			`resource "aws_elasticache_subnet_group" "${resource.name}-subnets"`,
			() => {
				writer.line(
					`name       = ${hclString(`${base}-${suffix}`.slice(0, 255))}`,
				);
				writer.line(
					`subnet_ids = [${subnetRefs.map((ref) => refAddress(ctx.addressById, ref)).join(", ")}]`,
				);
				writeTags(writer, `${resource.label ?? resource.name} subnets`);
			},
		);
		writer.blank();
	}

	writer.block(`resource "aws_elasticache_cluster" "${resource.name}"`, () => {
		writer.line(
			`cluster_id           = ${hclString(`${base}-${suffix}`.slice(0, 50))}`,
		);
		writer.line(
			`engine               = ${hclString(typeof resource.attributes.engine === "string" ? resource.attributes.engine : "redis")}`,
		);
		writer.line(
			`node_type            = ${hclString(typeof resource.attributes.node_type === "string" ? resource.attributes.node_type : "cache.t3.micro")}`,
		);
		writer.line(
			`num_cache_nodes      = ${typeof resource.attributes.num_cache_nodes === "number" ? resource.attributes.num_cache_nodes : 1}`,
		);
		writer.line(
			`port                 = ${typeof resource.attributes.port === "number" ? resource.attributes.port : 6379}`,
		);
		const paramGroup = resource.attributes.parameter_group_name;
		if (typeof paramGroup === "string") {
			writer.line(`parameter_group_name = ${hclString(paramGroup)}`);
		}
		const sgRefs =
			Array.isArray(resource.attributes.security_group_refs) &&
			resource.attributes.security_group_refs.every(
				(ref): ref is string => typeof ref === "string",
			)
				? resource.attributes.security_group_refs
				: [];
		if (sgRefs.length > 0) {
			writer.line(
				`security_group_ids   = [${sgRefs.map((ref) => refAddress(ctx.addressById, ref)).join(", ")}]`,
			);
		}
		if (subnetRefs.length > 0) {
			writer.line(
				`subnet_group_name    = aws_elasticache_subnet_group.${resource.name}-subnets.name`,
			);
		}
		writeTags(writer, resource.label ?? resource.name);
		const deps = dependencyAddresses(resource, ctx.addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});
}

const IAM_PRINCIPALS: Record<string, string> = {
	ec2: "ec2.amazonaws.com",
	lambda: "lambda.amazonaws.com",
	"ecs-tasks": "ecs-tasks.amazonaws.com",
	apigateway: "apigateway.amazonaws.com",
	eks: "eks.amazonaws.com",
	events: "events.amazonaws.com",
	ssm: "ssm.amazonaws.com",
};

function writeIamRole(
	writer: HclWriter,
	resource: IRResource,
	ctx: CompileContext,
): void {
	const assumeService =
		typeof resource.attributes.assume_service === "string"
			? resource.attributes.assume_service
			: "ec2";
	const principal = IAM_PRINCIPALS[assumeService] ?? "ec2.amazonaws.com";
	const roleName = hclString(
		(typeof resource.attributes.role_name === "string"
			? resource.attributes.role_name
			: `cloudman-${resource.name}`
		).slice(0, 64),
	);

	const policyDocument = {
		Version: "2012-10-17",
		Statement: [
			{
				Action: "sts:AssumeRole",
				Effect: "Allow",
				Principal: { Service: principal },
			},
		],
	};

	writer.block(`resource "aws_iam_role" "${resource.name}"`, () => {
		writer.line(`name                = ${roleName}`);
		writer.line(
			`assume_role_policy  = ${hclString(JSON.stringify(policyDocument))}`,
		);
		writer.line(`path                = ${hclString("/")}`);
		writeTags(writer, resource.label ?? resource.name);
		const deps = dependencyAddresses(resource, ctx.addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});
}

function writeIamPolicy(
	writer: HclWriter,
	resource: IRResource,
	ctx: CompileContext,
): void {
	const policyName = hclString(
		(typeof resource.attributes.policy_name === "string"
			? resource.attributes.policy_name
			: `cloudman-${resource.name}`
		).slice(0, 128),
	);

	const actions = Array.isArray(resource.attributes.actions)
		? resource.attributes.actions.filter(
				(action): action is string => typeof action === "string",
			)
		: [];
	const resources = Array.isArray(resource.attributes.resources)
		? resource.attributes.resources.filter(
				(r): r is string => typeof r === "string",
			)
		: [];
	const policyDocument = {
		Version: "2012-10-17",
		Statement: [
			{
				Effect: "Allow",
				Action: actions,
				Resource: resources,
			},
		],
	};

	writer.block(`resource "aws_iam_policy" "${resource.name}"`, () => {
		writer.line(`name   = ${policyName}`);
		writer.line(`policy = ${hclString(JSON.stringify(policyDocument))}`);
		writeTags(writer, resource.label ?? resource.name);
		const deps = dependencyAddresses(resource, ctx.addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});

	const roleRefs =
		Array.isArray(resource.attributes.role_refs) &&
		resource.attributes.role_refs.every(
			(ref): ref is string => typeof ref === "string",
		)
			? resource.attributes.role_refs
			: [];
	roleRefs.forEach((role, index) => {
		writer.blank();
		writer.block(
			`resource "aws_iam_role_policy_attachment" "${resource.name}-attach-${index + 1}"`,
			() => {
				writer.line(`role       = ${refAttr(ctx.addressById, role, "name")}`);
				writer.line(`policy_arn = aws_iam_policy.${resource.name}.arn`);
			},
		);
	});
}

function writeSqs(
	writer: HclWriter,
	resource: IRResource,
	ctx: CompileContext,
): void {
	const fifo = resource.attributes.fifo_queue === true;
	const queueName = hclString(
		`cloudman-${resource.name}${fifo ? ".fifo" : ""}`.slice(0, 80),
	);

	writer.block(`resource "aws_sqs_queue" "${resource.name}"`, () => {
		writer.line(`name                       = ${queueName}`);
		writer.line(
			`visibility_timeout_seconds = ${typeof resource.attributes.visibility_timeout_seconds === "number" ? resource.attributes.visibility_timeout_seconds : 30}`,
		);
		writer.line(
			`delay_seconds              = ${typeof resource.attributes.delay_seconds === "number" ? resource.attributes.delay_seconds : 0}`,
		);
		if (fifo) writer.line("fifo_queue                 = true");
		writeTags(writer, resource.label ?? resource.name);
		const deps = dependencyAddresses(resource, ctx.addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});
}

function writeSns(
	writer: HclWriter,
	resource: IRResource,
	ctx: CompileContext,
): void {
	const suffix = ctx.options.bucketNameSuffix ?? "change-me";

	writer.block(`resource "aws_sns_topic" "${resource.name}"`, () => {
		writer.line(
			`name = ${hclString(`cloudman-${resource.name}-${suffix}`.slice(0, 256))}`,
		);
		if (typeof resource.attributes.display_name === "string") {
			writer.line(
				`display_name = ${hclString(resource.attributes.display_name)}`,
			);
		}
		writeTags(writer, resource.label ?? resource.name);
		const deps = dependencyAddresses(resource, ctx.addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});
}

function writeRoute53Zone(
	writer: HclWriter,
	resource: IRResource,
	ctx: CompileContext,
): void {
	writer.block(`resource "aws_route53_zone" "${resource.name}"`, () => {
		const zoneName = resource.attributes.zone_name;
		writer.line(
			`name = ${hclString(typeof zoneName === "string" ? zoneName : "example.com")}`,
		);
		if (typeof resource.attributes.comment === "string") {
			writer.line(`comment = ${hclString(resource.attributes.comment)}`);
		}
		if (resource.attributes.private_zone === true) {
			const vpcRef = resource.attributes.vpc_ref;
			if (typeof vpcRef === "string") {
				writer.blank();
				writer.block("vpc", () => {
					writer.line(`vpc_id = ${refAddress(ctx.addressById, vpcRef)}`);
				});
			}
		}
		writeTags(writer, resource.label ?? resource.name);
		const deps = dependencyAddresses(resource, ctx.addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});
}

function writeRoute53Record(
	writer: HclWriter,
	resource: IRResource,
	ctx: CompileContext,
): void {
	const aliasRef = resource.attributes.alias_ref;
	const zoneRef = resource.attributes.zone_ref;
	if (typeof zoneRef !== "string") {
		// Validation already flags this; emit a no-op to preserve ordering.
		return;
	}

	writer.block(`resource "aws_route53_record" "${resource.name}"`, () => {
		writer.line(`zone_id = ${refAttr(ctx.addressById, zoneRef, "zone_id")}`);
		const recordName =
			typeof resource.attributes.record_name === "string"
				? resource.attributes.record_name
				: "app";
		const zoneName = ctx.zoneNames.get(zoneRef) ?? "example.com";
		writer.line(`name    = ${hclString(fqnForName(recordName, zoneName))}`);
		if (typeof aliasRef === "string") {
			writer.line(
				`type = ${hclString(typeof resource.attributes.record_type === "string" ? resource.attributes.record_type : "A")}`,
			);
			writer.blank();
			writer.block("alias", () => {
				writer.line(
					`name                   = ${refAttr(ctx.addressById, aliasRef, "dns_name")}`,
				);
				writer.line(
					`zone_id                = ${refAttr(ctx.addressById, aliasRef, "zone_id")}`,
				);
				writer.line("evaluate_target_health = true");
			});
		} else {
			writer.line(
				`type    = ${hclString(typeof resource.attributes.record_type === "string" ? resource.attributes.record_type : "A")}`,
			);
			writer.line(
				`ttl     = ${typeof resource.attributes.ttl === "number" ? resource.attributes.ttl : 300}`,
			);
			const records =
				Array.isArray(resource.attributes.records) &&
				resource.attributes.records.every(
					(record): record is string => typeof record === "string",
				)
					? resource.attributes.records
					: [];
			if (records.length > 0) {
				writer.line(
					`records = [${records.map((record) => hclString(record)).join(", ")}]`,
				);
			}
		}
		writeTags(writer, resource.label ?? resource.name);
	});
}

function fqnForName(recordName: string, zoneName: string): string {
	if (recordName === "@") return zoneName;
	if (recordName === zoneName || recordName.endsWith(`.${zoneName}`))
		return recordName;
	return `${recordName}.${zoneName}`;
}

function writeCloudwatchLogGroup(
	writer: HclWriter,
	resource: IRResource,
	ctx: CompileContext,
): void {
	writer.block(`resource "aws_cloudwatch_log_group" "${resource.name}"`, () => {
		writer.line(
			`name              = ${hclString(`/cloudman/${resource.name}`)}`,
		);
		writer.line(
			`retention_in_days = ${typeof resource.attributes.retention_days === "number" ? resource.attributes.retention_days : 14}`,
		);
		writeTags(writer, resource.label ?? resource.name);
		const deps = dependencyAddresses(resource, ctx.addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});
}

function writeApiGateway(
	writer: HclWriter,
	resource: IRResource,
	ctx: CompileContext,
): void {
	const suffix = ctx.options.bucketNameSuffix ?? "change-me";
	const base = `cloudman-${resource.name}`;

	writer.block(`resource "aws_api_gateway_rest_api" "${resource.name}"`, () => {
		writer.line(
			`name        = ${hclString(`${base}-${suffix}`.slice(0, 255))}`,
		);
		writer.blank();
		writer.block("endpoint_configuration", () => {
			writer.line('types = ["REGIONAL"]');
		});
		writeTags(writer, resource.label ?? resource.name);
		const deps = dependencyAddresses(resource, ctx.addressById);
		if (deps.length > 0) {
			writer.blank();
			writer.line(`depends_on = [${deps.join(", ")}]`);
		}
	});
	writer.blank();

	const routePath =
		typeof resource.attributes.route_path === "string"
			? resource.attributes.route_path
			: "{proxy+}";
	const method =
		typeof resource.attributes.http_method === "string"
			? resource.attributes.http_method
			: "ANY";

	writer.block(
		`resource "aws_api_gateway_resource" "${resource.name}-resource"`,
		() => {
			writer.line(`rest_api_id = aws_api_gateway_rest_api.${resource.name}.id`);
			writer.line(
				`parent_id   = aws_api_gateway_rest_api.${resource.name}.root_resource_id`,
			);
			writer.line(`path_part   = ${hclString(routePath)}`);
		},
	);
	writer.blank();

	writer.block(
		`resource "aws_api_gateway_method" "${resource.name}-method"`,
		() => {
			writer.line(
				`rest_api_id   = aws_api_gateway_rest_api.${resource.name}.id`,
			);
			writer.line(
				`resource_id   = aws_api_gateway_resource.${resource.name}-resource.id`,
			);
			writer.line(`http_method   = ${hclString(method)}`);
			writer.line('authorization = "NONE"');
		},
	);
	writer.blank();

	const lambdaRefs =
		Array.isArray(resource.attributes.lambda_refs) &&
		resource.attributes.lambda_refs.every(
			(ref): ref is string => typeof ref === "string",
		)
			? resource.attributes.lambda_refs
			: [];
	const lambda = lambdaRefs[0];
	if (lambda !== undefined) {
		writer.block(
			`resource "aws_api_gateway_integration" "${resource.name}-integration"`,
			() => {
				writer.line(
					`rest_api_id = aws_api_gateway_rest_api.${resource.name}.id`,
				);
				writer.line(
					`resource_id = aws_api_gateway_resource.${resource.name}-resource.id`,
				);
				writer.line(
					`http_method = aws_api_gateway_method.${resource.name}-method.http_method`,
				);
				writer.line('type                    = "AWS_PROXY"');
				writer.line('integration_http_method  = "POST"');
				const uri = `arn:aws:apigateway:${ctx.region}:lambda:path/2015-03-31/functions/\${${refAttr(ctx.addressById, lambda, "arn")}}/invocations`;
				writer.line(`uri                     = ${hclInterpString(uri)}`);
			},
		);
		writer.blank();

		writer.block(
			`resource "aws_lambda_permission" "${resource.name}-permission"`,
			() => {
				writer.line(`action        = "lambda:InvokeFunction"`);
				writer.line(
					`function_name = ${refAttr(ctx.addressById, lambda, "arn")}`,
				);
				writer.line(`principal     = ${hclString("apigateway.amazonaws.com")}`);
				writer.line(
					`source_arn    = ${hclString("arn:aws:execute-api:*:*:*/*")}`,
				);
			},
		);
		writer.blank();
	}

	writer.block(
		`resource "aws_api_gateway_deployment" "${resource.name}-deployment"`,
		() => {
			writer.line(`rest_api_id = aws_api_gateway_rest_api.${resource.name}.id`);
			if (lambda !== undefined) {
				writer.blank();
				writer.line(
					`depends_on = [aws_api_gateway_integration.${resource.name}-integration]`,
				);
			}
		},
	);
	writer.blank();

	const stageName =
		typeof resource.attributes.stage_name === "string"
			? resource.attributes.stage_name
			: "v1";
	writer.block(
		`resource "aws_api_gateway_stage" "${resource.name}-stage"`,
		() => {
			writer.line(`stage_name    = ${hclString(stageName)}`);
			writer.line(
				`rest_api_id   = aws_api_gateway_rest_api.${resource.name}.id`,
			);
			writer.line(
				`deployment_id = aws_api_gateway_deployment.${resource.name}-deployment.id`,
			);
		},
	);
}

export function compileIR(
	document: IRDocument,
	options: CompileOptions = {},
): CompiledFile[] {
	const addressById = new Map<string, string>();
	for (const resource of document.resources) {
		addressById.set(resource.irId, tofuAddress(resource));
	}

	const ctx: CompileContext = {
		addressById,
		options,
		region: document.region,
		zoneNames: new Map<string, string>(),
	};
	for (const resource of document.resources) {
		const zoneName = resource.attributes.zone_name;
		if (resource.kind === "aws_route53_zone" && typeof zoneName === "string") {
			ctx.zoneNames.set(resource.irId, zoneName);
		}
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
		switch (resource.kind) {
			case "aws_instance":
				writeEc2(main, resource, addressById);
				break;
			case "aws_s3_bucket":
				writeS3(main, resource, addressById, options);
				break;
			case "aws_vpc":
				writeVpc(main, resource, addressById);
				break;
			case "aws_subnet":
				writeSubnet(main, resource, addressById);
				break;
			case "aws_security_group":
				writeSecurityGroup(main, resource, addressById);
				break;
			case "aws_dynamodb_table":
				writeDynamoDb(main, resource, addressById, options);
				break;
			case "aws_db_instance":
				writeRds(main, resource, addressById, options);
				break;
			case "aws_internet_gateway":
				writeInternetGateway(main, resource, ctx);
				break;
			case "aws_nat_gateway":
				writeNatGateway(main, resource, ctx);
				break;
			case "aws_lb":
				writeAlb(main, resource, ctx);
				break;
			case "aws_ecr_repository":
				writeEcr(main, resource, ctx);
				break;
			case "aws_lambda_function":
				writeLambda(main, resource, ctx);
				break;
			case "aws_ecs_cluster":
				writeEcs(main, resource, ctx);
				break;
			case "aws_ebs_volume":
				writeEbs(main, resource, ctx);
				break;
			case "aws_efs_file_system":
				writeEfs(main, resource, ctx);
				break;
			case "aws_rds_cluster":
				writeAurora(main, resource, ctx);
				break;
			case "aws_elasticache_cluster":
				writeElasticache(main, resource, ctx);
				break;
			case "aws_iam_role":
				writeIamRole(main, resource, ctx);
				break;
			case "aws_iam_policy":
				writeIamPolicy(main, resource, ctx);
				break;
			case "aws_sqs_queue":
				writeSqs(main, resource, ctx);
				break;
			case "aws_sns_topic":
				writeSns(main, resource, ctx);
				break;
			case "aws_route53_zone":
				writeRoute53Zone(main, resource, ctx);
				break;
			case "aws_route53_record":
				writeRoute53Record(main, resource, ctx);
				break;
			case "aws_cloudwatch_log_group":
				writeCloudwatchLogGroup(main, resource, ctx);
				break;
			case "aws_api_gateway_rest_api":
				writeApiGateway(main, resource, ctx);
				break;
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
