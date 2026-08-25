import type { InfrastructureGraph } from "./schema";

/**
 * Edge semantics: { source, target } means "source depends on target".
 * Networking wiring therefore follows consumer → dependency:
 *   ec2 → subnet            (instance receives subnet_id)
 *   ec2 → security_group    (instance receives vpc_security_group_ids)
 *   subnet → vpc            (subnet receives vpc_id)
 *   security_group → vpc    (direct parent, optional when inheritable)
 *   rds → subnet(s)         (db receives a synthesized subnet group)
 *   rds → security_group    (db receives vpc_security_group_ids)
 */
export interface NodeRefs {
	/** Parent VPC id discovered from outgoing edges (subnet, or direct sg→vpc). */
	vpc?: string;
	/** Single-subnet consumers (ec2): last ec2→subnet edge wins. */
	subnet?: string;
	/** All subnets this consumer points at (ec2, rds). */
	subnets: string[];
	/** Security groups this consumer points at (ec2, rds). */
	securityGroups: string[];
	/** Instances attached to this security group via ec2→sg edges (sg). */
	attachedInstances: string[];
}

/**
 * Computes per-node network references from graph edges.
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
		});
	}

	for (const edge of graph.edges) {
		const sourceType = typeById.get(edge.source);
		const targetType = typeById.get(edge.target);
		if (!sourceType || !targetType) continue;
		const sourceRefs = refs.get(edge.source);
		if (!sourceRefs) continue;

		if (
			(sourceType === "aws_ec2" || sourceType === "aws_rds") &&
			targetType === "aws_subnet"
		) {
			if (!sourceRefs.subnets.includes(edge.target))
				sourceRefs.subnets.push(edge.target);
			sourceRefs.subnet = edge.target;
		} else if (
			(sourceType === "aws_ec2" || sourceType === "aws_rds") &&
			targetType === "aws_security_group"
		) {
			sourceRefs.securityGroups.push(edge.target);
		} else if (sourceType === "aws_subnet" && targetType === "aws_vpc") {
			sourceRefs.vpc = edge.target;
		} else if (
			sourceType === "aws_security_group" &&
			targetType === "aws_vpc"
		) {
			sourceRefs.vpc = edge.target;
		}

		const targetRefs = refs.get(edge.target);
		if (
			targetRefs &&
			sourceType === "aws_ec2" &&
			targetType === "aws_security_group"
		) {
			targetRefs.attachedInstances.push(edge.source);
		}
	}

	return refs;
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
