import type { InfrastructureGraph } from "./schema";

const SUBNET_CONSUMERS = new Set([
	"aws_ec2",
	"aws_rds",
	"aws_lambda",
	"aws_ecs",
	"aws_aurora",
	"aws_elasticache",
	"aws_alb",
	"aws_nat_gateway",
	"aws_efs",
]);

const SG_CONSUMERS = new Set([
	"aws_ec2",
	"aws_rds",
	"aws_lambda",
	"aws_ecs",
	"aws_aurora",
	"aws_elasticache",
	"aws_alb",
	"aws_efs",
]);

/**
 * Edge semantics: { source, target } means "source depends on target".
 * Wiring therefore follows consumer → dependency (target refs below are
 * resolved through the node's outgoing edges, except "attached/lbTargets"
 * which are incoming edges recorded on the target node):
 *   ec2 → subnet            (instance receives subnet_id)
 *   ec2 → security_group    (instance receives vpc_security_group_ids)
 *   ec2 → alb               (instance becomes an ALB target group member)
 *   subnet → vpc            (subnet receives vpc_id)
 *   security_group → vpc    (direct parent, optional when inheritable)
 *   rds → subnet(s)         (db receives a synthesized subnet group)
 *   rds → security_group    (db receives vpc_security_group_ids)
 *   lambda/ecs → iam_role   (function / task execution role)
 *   lambda/ecs → ecr        (container image repository)
 *   lambda/ecs/aurora/...   (→ subnet / security_group placement)
 *   ebs → ec2               (volume attached to the instance)
 *   iam_policy → iam_role   (policy synthesized into a role attachment)
 *   route53_record → zone   (record lives in the hosted zone)
 *   route53_record → alb    (record aliases the load balancer DNS name)
 *   apigateway → lambda     (REST API proxies requests to the function)
 */
export interface NodeRefs {
	/** Parent VPC id discovered from outgoing edges (subnet, sg, igw, efs…). */
	vpc?: string;
	/** Single-subnet consumers (ec2, nat): last consumer→subnet edge wins. */
	subnet?: string;
	/** All subnets this consumer points at (ec2, rds, lambda, ecs, alb…). */
	subnets: string[];
	/** Security groups this consumer points at (ec2, rds, lambda, ecs, alb…). */
	securityGroups: string[];
	/** Instances attached to this security group via ec2→sg edges (sg). */
	attachedInstances: string[];
	/** EC2 instances registered to this load balancer (alb). */
	lbTargets: string[];
	/** EC2 instance an EBS volume attaches to (ebs). */
	instanceRef?: string;
	/** Lambda/ECS execution role (lambda, ecs). */
	iamRole?: string;
	/** IAM roles a policy attaches to (iam_policy). */
	roles: string[];
	/** ECR repositories serving as container image sources (lambda, ecs). */
	repositories: string[];
	/** Hosted zone a record belongs to (route53_record). */
	zone?: string;
	/** Load balancer a record aliases (route53_record). */
	albAlias?: string;
	/** Lambda functions an API Gateway proxies to (apigateway). */
	targetFunctions: string[];
}

/**
 * Computes per-node network/reference wiring from graph edges.
 * Only edges between known node ids are considered.
 */
export function resolveNodeRefs(
	graph: InfrastructureGraph,
): Map<string, NodeRefs> {
	const typeById = new Map<string, string>();
	for (const node of graph.nodes) typeById.set(node.id, node.type);

	const refs = new Map<string, NodeRefs>();
	for (const node of graph.nodes) {
		refs.set(node.id, {
			subnets: [],
			securityGroups: [],
			attachedInstances: [],
			lbTargets: [],
			roles: [],
			repositories: [],
			targetFunctions: [],
		});
	}

	for (const edge of graph.edges) {
		const sourceType = typeById.get(edge.source);
		const targetType = typeById.get(edge.target);
		if (!sourceType || !targetType) continue;
		const sourceRefs = refs.get(edge.source);
		if (!sourceRefs) continue;

		if (SUBNET_CONSUMERS.has(sourceType) && targetType === "aws_subnet") {
			if (!sourceRefs.subnets.includes(edge.target))
				sourceRefs.subnets.push(edge.target);
			if (sourceType === "aws_ec2" || sourceType === "aws_nat_gateway")
				sourceRefs.subnet = edge.target;
		} else if (
			SG_CONSUMERS.has(sourceType) &&
			targetType === "aws_security_group"
		) {
			sourceRefs.securityGroups.push(edge.target);
		} else if (sourceType === "aws_ebs" && targetType === "aws_ec2") {
			sourceRefs.instanceRef = edge.target;
		} else if (
			(sourceType === "aws_lambda" || sourceType === "aws_ecs") &&
			targetType === "aws_iam_role"
		) {
			sourceRefs.iamRole = edge.target;
		} else if (
			(sourceType === "aws_lambda" || sourceType === "aws_ecs") &&
			targetType === "aws_ecr"
		) {
			if (!sourceRefs.repositories.includes(edge.target))
				sourceRefs.repositories.push(edge.target);
		} else if (
			sourceType === "aws_iam_policy" &&
			targetType === "aws_iam_role"
		) {
			sourceRefs.roles.push(edge.target);
		} else if (
			sourceType === "aws_route53_record" &&
			targetType === "aws_route53_zone"
		) {
			sourceRefs.zone = edge.target;
		} else if (
			sourceType === "aws_route53_record" &&
			targetType === "aws_alb"
		) {
			sourceRefs.albAlias = edge.target;
		} else if (sourceType === "aws_apigateway" && targetType === "aws_lambda") {
			sourceRefs.targetFunctions.push(edge.target);
		} else if (targetType === "aws_vpc") {
			// Direct parent: subnet, security group, igw, efs, alb, private zone.
			sourceRefs.vpc = edge.target;
		}

		const targetRefs = refs.get(edge.target);
		if (!targetRefs) continue;
		if (sourceType === "aws_ec2" && targetType === "aws_security_group") {
			targetRefs.attachedInstances.push(edge.source);
		} else if (sourceType === "aws_ec2" && targetType === "aws_alb") {
			targetRefs.lbTargets.push(edge.source);
		}
	}

	return refs;
}

/**
 * Effective VPC for a consumer: its direct apex→vpc edge wins; otherwise the
 * VPC is inherited from the first subnet it is wired to (mirrors sg behavior).
 */
export function consumerVpc(
	nodeId: string,
	nodeRefs: Map<string, NodeRefs>,
): string | undefined {
	const refs = nodeRefs.get(nodeId);
	if (refs?.vpc) return refs.vpc;
	const subnetId = refs?.subnet;
	if (subnetId) return nodeRefs.get(subnetId)?.vpc;
	for (const subnet of refs?.subnets ?? []) {
		const vpc = nodeRefs.get(subnet)?.vpc;
		if (vpc) return vpc;
	}
	return undefined;
}

/**
 * Effective VPC for a security group: direct sg→vpc edge wins; otherwise it
 * inherits the VPC of the subnet of the first attached instance that has one.
 */
export function sgEffectiveVpc(
	sgId: string,
	graph: InfrastructureGraph,
	nodeRefs: Map<string, NodeRefs>,
): string | undefined {
	const own = nodeRefs.get(sgId);
	if (own?.vpc) return own.vpc;
	const typeById = new Map<string, string>();
	for (const node of graph.nodes) typeById.set(node.id, node.type);

	for (const instanceId of own?.attachedInstances ?? []) {
		if (typeById.get(instanceId) !== "aws_ec2") continue;
		const subnetId = nodeRefs.get(instanceId)?.subnet;
		if (!subnetId) continue;
		const vpcId = nodeRefs.get(subnetId)?.vpc;
		if (vpcId) return vpcId;
	}
	return undefined;
}
