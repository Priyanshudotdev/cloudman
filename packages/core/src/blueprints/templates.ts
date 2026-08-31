import type { InfrastructureGraph } from "../graph/schema";
import type { BlueprintGraph } from "./types";

function edge(
	source: string,
	target: string,
): { id: string; source: string; target: string } {
	return {
		id: `e-${source}-${target}`,
		source,
		target,
	};
}

function webAppGraph(): InfrastructureGraph {
	return {
		version: 1,
		name: "web-app",
		nodes: [
			{ id: "vpc-1", type: "aws_vpc", config: { cidrBlock: "10.0.0.0/16" } },
			{
				id: "subnet-pub",
				type: "aws_subnet",
				config: { cidrBlock: "10.0.1.0/24" },
			},
			{
				id: "subnet-priv",
				type: "aws_subnet",
				config: { cidrBlock: "10.0.2.0/24" },
			},
			{ id: "igw-1", type: "aws_internet_gateway", config: {} },
			{
				id: "sg-web",
				type: "aws_security_group",
				config: {
					description: "public web tier",
					ingressRules: [
						{
							fromPort: 80,
							toPort: 80,
							protocol: "tcp",
							cidrBlock: "0.0.0.0/0",
						},
					],
				},
			},
			{ id: "alb-1", type: "aws_alb", config: { scheme: "internet-facing" } },
			{ id: "web-1", type: "aws_ec2", config: { instanceType: "t3.small" } },
			{
				id: "vol-1",
				type: "aws_ebs",
				config: { sizeGb: 20, encrypted: true },
			},
		],
		edges: [
			edge("subnet-pub", "vpc-1"),
			edge("subnet-priv", "vpc-1"),
			edge("igw-1", "vpc-1"),
			edge("sg-web", "vpc-1"),
			edge("alb-1", "subnet-pub"),
			edge("alb-1", "subnet-priv"),
			edge("alb-1", "sg-web"),
			edge("web-1", "subnet-pub"),
			edge("web-1", "sg-web"),
			edge("vol-1", "web-1"),
		],
	};
}

function serverlessApiGraph(): InfrastructureGraph {
	return {
		version: 1,
		name: "serverless-api",
		nodes: [
			{ id: "vpc-1", type: "aws_vpc", config: { cidrBlock: "10.0.0.0/16" } },
			{
				id: "subnet-pub",
				type: "aws_subnet",
				config: { cidrBlock: "10.0.1.0/24" },
			},
			{
				id: "subnet-priv",
				type: "aws_subnet",
				config: { cidrBlock: "10.0.2.0/24" },
			},
			{
				id: "sg-lambda",
				type: "aws_security_group",
				config: { description: "lambda functions" },
			},
			{ id: "repo-1", type: "aws_ecr", config: {} },
			{
				id: "role-1",
				type: "aws_iam_role",
				config: { assumeService: "lambda" },
			},
			{
				id: "fn-1",
				type: "aws_lambda",
				config: { runtime: "python3.12", memoryMb: 256 },
			},
			{ id: "fn-2", type: "aws_lambda", config: { runtime: "nodejs22.x" } },
			{
				id: "api-1",
				type: "aws_apigateway",
				config: { routePath: "/{proxy+}", httpMethod: "ANY" },
			},
		],
		edges: [
			edge("subnet-pub", "vpc-1"),
			edge("subnet-priv", "vpc-1"),
			edge("sg-lambda", "vpc-1"),
			edge("repo-1", "vpc-1"),
			edge("role-1", "vpc-1"),
			edge("fn-1", "subnet-priv"),
			edge("fn-1", "sg-lambda"),
			edge("fn-1", "role-1"),
			edge("fn-1", "repo-1"),
			edge("fn-2", "subnet-priv"),
			edge("fn-2", "sg-lambda"),
			edge("fn-2", "role-1"),
			edge("fn-2", "repo-1"),
			edge("api-1", "vpc-1"),
			edge("api-1", "fn-1"),
			edge("api-1", "fn-2"),
		],
	};
}

function dataPipelineGraph(): InfrastructureGraph {
	return {
		version: 1,
		name: "data-pipeline",
		nodes: [
			{ id: "bucket-1", type: "aws_s3", config: { versioning: true } },
			{ id: "queue-1", type: "aws_sqs", config: {} },
			{
				id: "table-1",
				type: "aws_dynamodb_table",
				config: { hashKey: "id" },
			},
			{
				id: "role-1",
				type: "aws_iam_role",
				config: { assumeService: "lambda" },
			},
			{ id: "repo-1", type: "aws_ecr", config: {} },
			{
				id: "fn-1",
				type: "aws_lambda",
				config: { runtime: "python3.13", memoryMb: 512 },
			},
		],
		edges: [
			edge("fn-1", "bucket-1"),
			edge("fn-1", "queue-1"),
			edge("fn-1", "table-1"),
			edge("fn-1", "role-1"),
			edge("fn-1", "repo-1"),
		],
	};
}

const graphs: Record<string, BlueprintGraph> = {
	"web-app": {
		metadata: {
			id: "web-app",
			name: "Web App on EC2",
			description: "Public ALB in front of an EC2 web tier with EBS storage",
			tags: ["web", "ec2", "alb", "blog", "website"],
		},
		build: webAppGraph,
	},
	"serverless-api": {
		metadata: {
			id: "serverless-api",
			name: "Serverless API",
			description: "API Gateway in front of Lambda functions backed by ECR",
			tags: ["serverless", "lambda", "api", "function"],
		},
		build: serverlessApiGraph,
	},
	"data-pipeline": {
		metadata: {
			id: "data-pipeline",
			name: "Data Pipeline",
			description: "Lambda processor wired to S3, SQS, and DynamoDB",
			tags: ["data", "pipeline", "queue", "analytics", "etl"],
		},
		build: dataPipelineGraph,
	},
};

export const DEFAULT_BLUEPRINT = "web-app";
export const MAX_PROMPT_LENGTH = 500;

export function listBlueprints(): BlueprintGraph["metadata"][] {
	return [...Object.values(graphs)].map((b) => b.metadata);
}

function matchBlueprint(prompt: string): string {
	const text = prompt.toLowerCase();
	let best: { id: string; score: number } | undefined;
	for (const blueprint of Object.values(graphs)) {
		let score = 0;
		for (const tag of blueprint.metadata.tags) {
			if (text.includes(tag)) score += tag.length;
		}
		if (score > 0 && (best === undefined || score > best.score)) {
			best = { id: blueprint.metadata.id, score };
		}
	}
	return best?.id ?? DEFAULT_BLUEPRINT;
}

/** Deterministic, offline stack generation from a natural-language prompt. */
export function generateGraphFromPrompt(prompt: string): {
	blueprint: string;
	graph: InfrastructureGraph;
	warnings: string[];
} {
	const blueprintId = matchBlueprint(prompt);
	const blueprint = graphs[blueprintId];
	if (!blueprint) {
		throw new Error(`Unknown blueprint "${blueprintId}"`);
	}
	const graph = structuredClone(blueprint.build());
	graph.name =
		prompt.trim().slice(0, 60).toLowerCase().replace(/\s+/g, "-") ||
		blueprintId;
	const warnings = [
		`Generated from the "${blueprint.metadata.name}" template; edit nodes before saving.`,
	];
	return { blueprint: blueprintId, graph, warnings };
}
