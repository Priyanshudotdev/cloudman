import type { IRDocument } from "../ir/schema";
import type { ResourceRisk } from "./types";

interface IngressRuleLike {
	from_port?: unknown;
	to_port?: unknown;
	protocol?: unknown;
	cidr_block?: unknown;
}

function rules(value: unknown): IngressRuleLike[] {
	return Array.isArray(value) ? (value as IngressRuleLike[]) : [];
}

/** Static, deterministic security & cost-hygiene review of a compiled document. */
export function analyzeRisks(document: IRDocument): ResourceRisk[] {
	const risks: ResourceRisk[] = [];

	for (const resource of document.resources) {
		const a = resource.attributes;
		const push = (
			severity: ResourceRisk["severity"],
			code: string,
			message: string,
		) =>
			risks.push({
				irId: resource.irId,
				kind: resource.kind,
				label: resource.label ?? resource.irId,
				severity,
				code,
				message,
			});

		if (resource.kind === "aws_security_group") {
			for (const rule of rules(a.ingress_rules)) {
				if (rule.cidr_block === "0.0.0.0/0") {
					push(
						"medium",
						"SG_WORLD_OPEN",
						`Security group allows ingress from 0.0.0.0/0 (port ${String(rule.from_port ?? "*")}); consider restricting the CIDR.`,
					);
				}
			}
		}

		if (resource.kind === "aws_db_instance" && a.publicly_accessible === true) {
			push(
				"high",
				"DB_PUBLIC",
				"RDS is publicly accessible; prefer keeping it inside a VPC with no public route.",
			);
		}

		if (resource.kind === "aws_ebs_volume" && a.encrypted === false) {
			push("high", "EBS_UNENCRYPTED", "EBS volume is not encrypted at rest.");
		}

		if (resource.kind === "aws_efs_file_system" && a.encrypted === false) {
			push(
				"high",
				"EFS_UNENCRYPTED",
				"EFS file system is not encrypted at rest.",
			);
		}

		if (resource.kind === "aws_s3_bucket" && a.versioning === false) {
			push(
				"medium",
				"S3_NO_VERSIONING",
				"Bucket versioning is disabled; accidental deletes cannot be recovered.",
			);
		}

		if (resource.kind === "aws_instance") {
			const sgs = a.security_group_refs;
			if (!Array.isArray(sgs) || sgs.length === 0) {
				push(
					"medium",
					"EC2_NO_SG",
					"Instance has no security group; ensure inbound traffic is controlled elsewhere.",
				);
			}
		}

		if (
			resource.kind === "aws_lambda_function" &&
			typeof a.timeout === "number" &&
			a.timeout > 60
		) {
			push(
				"low",
				"LAMBDA_LONG_TIMEOUT",
				`Lambda timeout of ${a.timeout}s increases idle cost exposure; prefer async work below 60s.`,
			);
		}

		if (resource.kind === "aws_nat_gateway") {
			push(
				"medium",
				"NAT_COST_HOTSPOT",
				"NAT Gateways add ~$33/mo before data processing; consider private-only routing or a shared gateway.",
			);
		}

		if (
			resource.kind === "aws_sqs" &&
			a.visibility_timeout_seconds !== undefined &&
			(a.visibility_timeout_seconds as number) > 300
		) {
			push(
				"low",
				"SQS_LONG_VISIBILITY",
				"A long visibility timeout can mask slow consumers; monitor DLQ depth.",
			);
		}
	}

	return risks;
}
