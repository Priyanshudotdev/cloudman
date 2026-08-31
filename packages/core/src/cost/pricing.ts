import type { IRDocument, IRResource } from "../ir/schema";
import type { CostEstimate } from "./types";

export const MONTH_HOURS = 730;

/** Indicative hourly rates (us-east-1 list prices); fine for previews, not a bill. */
const instanceHourly: Record<string, number> = {
	"t2.micro": 0.0116,
	"t3.micro": 0.0104,
	"t3.small": 0.0208,
	"t3.medium": 0.0416,
};

const dbHourly: Record<string, number> = {
	"db.t3.micro": 0.017,
	"db.t3.small": 0.033,
	"db.t3.medium": 0.082,
};

const auroraHourly: Record<string, number> = {
	"db.t3.medium": 0.074,
	"db.t4g.medium": 0.062,
	"db.r5.large": 0.28,
	"db.r6g.large": 0.25,
};

const cacheHourly: Record<string, number> = {
	"cache.t3.micro": 0.017,
	"cache.t3.small": 0.034,
	"cache.t3.medium": 0.069,
	"cache.m7g.large": 0.177,
};

const ebsPerGbMonthly: Record<string, number> = {
	gp3: 0.08,
	gp2: 0.1,
	io1: 0.125,
	st1: 0.045,
	sc1: 0.016,
};

const FARGATE_VCPU_HOURLY = 0.04048;
const FARGATE_GB_HOURLY = 0.004445;
const GP3_GB_MONTHLY = ebsPerGbMonthly.gp3 ?? 0.08;

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseVcpu(raw: unknown): number | undefined {
	const s = str(raw);
	if (!s) return undefined;
	const match = /^([0-9.]+)\s*vCPU$/i.exec(s);
	return match
		? Number.parseFloat(match[1] ?? "")
		: Number.parseFloat(s) || undefined;
}

function parseGb(raw: unknown): number | undefined {
	const s = str(raw);
	if (!s) return undefined;
	const match = /^([0-9.]+)\s*GB$/i.exec(s);
	return match ? Number.parseFloat(match[1] ?? "") : undefined;
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

/** Estimates one resource from its resolved IR attributes. */
export function estimateResource(
	resource: IRResource,
	_byMonthHours?: number,
): CostEstimate {
	const a = resource.attributes;
	const notes: string[] = [];

	switch (resource.kind) {
		case "aws_instance": {
			const hourlyRate =
				instanceHourly[str(a.instance_type) ?? ""] ??
				instanceHourly["t3.micro"] ?? 0;
			const volumeGb = num(a.volume_size_gb) ?? 8;
			const monthly = hourlyRate * MONTH_HOURS + volumeGb * GP3_GB_MONTHLY;
			notes.push(
				`${str(a.instance_type) ?? "t3.micro"} × 730h = $${round(hourlyRate * MONTH_HOURS)}`,
				`root volume ${volumeGb} GB gp3 = $${round(volumeGb * GP3_GB_MONTHLY)}`,
			);
			return { monthly: round(monthly), notes };
		}
		case "aws_ebs_volume": {
			const perGb = ebsPerGbMonthly[str(a.volume_type) ?? "gp3"] ?? 0.08;
			const sizeGb = num(a.size_gb) ?? 10;
			let monthly = sizeGb * perGb;
			const iops = num(a.iops);
			if (iops !== undefined && a.volume_type === "io1") {
				monthly += iops * 0.065;
				notes.push(`provisioned IOPS ${iops} = $${round(iops * 0.065)}`);
			}
			notes.push(
				`${str(a.volume_type) ?? "gp3"} × ${sizeGb} GB = $${round(sizeGb * perGb)}`,
			);
			return { monthly: round(monthly), notes };
		}
		case "aws_db_instance": {
			const hourlyRate =
				dbHourly[str(a.instance_class) ?? ""] ?? dbHourly["db.t3.micro"] ?? 0;
			const storageGb = num(a.allocated_storage_gb) ?? 20;
			const monthly =
				hourlyRate * MONTH_HOURS + storageGb * GP3_GB_MONTHLY;
			notes.push(
				`${str(a.instance_class) ?? "db.t3.micro"} × 730h = $${round(hourlyRate * MONTH_HOURS)}`,
				`${storageGb} GB storage = $${round(storageGb * GP3_GB_MONTHLY)}`,
			);
			return { monthly: round(monthly), notes };
		}
		case "aws_rds_cluster": {
			const hourlyRate =
				auroraHourly[str(a.instance_class) ?? ""] ??
				auroraHourly["db.t4g.medium"] ?? 0;
			const monthly = hourlyRate * MONTH_HOURS;
			notes.push(
				`${str(a.instance_class) ?? "db.t4g.medium"} × 730h = $${round(monthly)} (storage billed per GB used)`,
			);
			return { monthly: round(monthly), notes };
		}
		case "aws_elasticache_cluster": {
			const hourlyRate =
				cacheHourly[str(a.node_type) ?? ""] ?? cacheHourly["cache.t3.micro"] ?? 0;
			const nodes = num(a.num_cache_nodes) ?? 1;
			const monthly = hourlyRate * MONTH_HOURS * nodes;
			notes.push(
				`${str(a.node_type) ?? "cache.t3.micro"} × ${nodes} node(s) × 730h = $${round(monthly)}`,
			);
			return { monthly: round(monthly), notes };
		}
		case "aws_ecs_cluster": {
			const vcpu = parseVcpu(a.cpu) ?? 0.25;
			const gb = parseGb(a.memory) ?? 0.5;
			const count = num(a.desired_count) ?? 1;
			const each =
				(vcpu * FARGATE_VCPU_HOURLY + gb * FARGATE_GB_HOURLY) * MONTH_HOURS;
			const monthly = each * count;
			notes.push(
				`Fargate ${vcpu} vCPU / ${gb} GB × ${count} task(s) × 730h = $${round(monthly)}`,
			);
			return { monthly: round(monthly), notes };
		}
		case "aws_lambda_function": {
			notes.push(
				"Lambda bills per request ($0.20/M) and GB-second, so cost starts near $0 at low traffic",
			);
			return { monthly: 0, notes };
		}
		case "aws_lb": {
			const monthly = 16.43;
			notes.push(
				`ALB base = $${monthly}/mo plus LCU usage (billed per consumed load-balancer capacity unit)`,
			);
			return { monthly, notes };
		}
		case "aws_nat_gateway": {
			const monthly = 0.045 * MONTH_HOURS;
			notes.push(
				`NAT Gateway × 730h = $${round(monthly)} plus $0.045 per GB processed`,
			);
			return { monthly: round(monthly), notes };
		}
		case "aws_route53_zone": {
			notes.push("Hosted zone = $0.50/mo plus $0.40 per million queries");
			return { monthly: 0.5, notes };
		}
		case "aws_s3_bucket": {
			notes.push("S3 Standard = $0.023/GB-mo (storage only; no size set)");
			return { monthly: 0, notes };
		}
		case "aws_ecr_repository": {
			notes.push("ECR = $0.10/GB-mo of stored images");
			return { monthly: 0, notes };
		}
		case "aws_efs_file_system": {
			notes.push("EFS Standard = $0.30/GB-mo when used");
			return { monthly: 0, notes };
		}
		case "aws_dynamodb_table": {
			notes.push(
				"On-demand: $1.25/M writes, $0.25/M reads (no provisioned capacity set)",
			);
			return { monthly: 0, notes };
		}
		case "aws_sqs_queue":
			notes.push("Standard queue = $0.40 per million requests");
			return { monthly: 0, notes };
		case "aws_sns_topic":
			notes.push("SNS = $0.50/M requests plus $0.06/GB delivered");
			return { monthly: 0, notes };
		case "aws_api_gateway_rest_api":
			notes.push("API Gateway = ~$3.50 per million requests");
			return { monthly: 0, notes };
		case "aws_cloudwatch_log_group":
			notes.push("CloudWatch Logs = $0.50 per GB ingested");
			return { monthly: 0, notes };
		case "aws_route53_record":
			notes.push("Record queries billed at ~$0.40/M");
			return { monthly: 0, notes };
		case "aws_vpc":
		case "aws_subnet":
		case "aws_security_group":
		case "aws_iam_role":
		case "aws_iam_policy":
		case "aws_internet_gateway":
			notes.push("No hourly charges for this resource");
			return { monthly: 0, notes };
		default:
			notes.push(`No indicative pricing data for ${resource.kind}`);
			return { monthly: 0, notes };
	}
}

/** Convenience entry point that always produces a deterministically ordered estimate. */
export function estimateResourceForDocument(
	document: IRDocument,
): CostEstimate {
	const rows = document.resources.map((r) => estimateResource(r));
	return {
		monthly: round(rows.reduce((sum, row) => sum + row.monthly, 0)),
		notes: rows.flatMap((row) => row.notes),
	};
}
