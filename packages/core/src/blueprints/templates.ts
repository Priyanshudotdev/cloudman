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

// Simple web server: 4 nodes, no ALB complexity, single AZ subnet fixed
function webAppGraph(): InfrastructureGraph {
	return {
		version: 1,
		name: "web-app",
		nodes: [
			{ id: "vpc-1", type: "aws_vpc", config: { cidrBlock: "10.0.0.0/16" } },
			{
				id: "subnet-pub",
				type: "aws_subnet",
				config: { cidrBlock: "10.0.1.0/24", availabilityZone: "us-east-1a" },
			},
			{
				id: "sg-web",
				type: "aws_security_group",
				config: {
					description: "web tier",
					ingressRules: [
						{ fromPort: 80, toPort: 80, protocol: "tcp", cidrBlock: "0.0.0.0/0" },
					],
				},
			},
			{ id: "web-1", type: "aws_ec2", config: { instanceType: "t3.micro" } },
		],
		edges: [
			edge("subnet-pub", "vpc-1"),
			edge("sg-web", "vpc-1"),
			edge("web-1", "subnet-pub"),
			edge("web-1", "sg-web"),
		],
	};
}

// Simple API: 4 nodes, no VPC complexity — keeps ECR for Lambda image build
function serverlessApiGraph(): InfrastructureGraph {
	return {
		version: 1,
		name: "serverless-api",
		nodes: [
			{ id: "role-1", type: "aws_iam_role", config: { assumeService: "lambda" } },
			{ id: "repo-1", type: "aws_ecr", config: {} },
			{ id: "fn-1", type: "aws_lambda", config: { runtime: "nodejs22.x", memoryMb: 128 } },
			{ id: "api-1", type: "aws_apigateway", config: { routePath: "/{proxy+}", httpMethod: "ANY" } },
		],
		edges: [edge("fn-1", "role-1"), edge("fn-1", "repo-1"), edge("api-1", "fn-1")],
	};
}

function reactAppGraph(): InfrastructureGraph {
	return {
		version: 1,
		name: "react-app",
		nodes: [
			{ id: "vpc-1", type: "aws_vpc", config: { cidrBlock: "10.0.0.0/16" } },
			{
				id: "subnet-pub",
				type: "aws_subnet",
				config: { cidrBlock: "10.0.1.0/24", availabilityZone: "us-east-1a" },
			},
			{
				id: "subnet-priv",
				type: "aws_subnet",
				config: { cidrBlock: "10.0.2.0/24", availabilityZone: "us-east-1b" },
			},
			{
				id: "sg-web",
				type: "aws_security_group",
				config: {
					description: "ecs tier",
					ingressRules: [{ fromPort: 80, toPort: 80, protocol: "tcp", cidrBlock: "0.0.0.0/0" }],
				},
			},
			{ id: "repo-1", type: "aws_ecr", config: {} },
			{ id: "role-1", type: "aws_iam_role", config: { assumeService: "ecs-tasks" } },
			{ id: "alb-1", type: "aws_alb", config: { scheme: "internet-facing" } },
			{
				id: "svc-1",
				type: "aws_ecs",
				config: { cpu: "0.25 vCPU", memory: "0.5 GB", containerPort: 80, desiredCount: 1, imageTag: "latest" },
			},
		],
		edges: [
			edge("subnet-pub", "vpc-1"),
			edge("subnet-priv", "vpc-1"),
			edge("sg-web", "vpc-1"),
			edge("repo-1", "vpc-1"),
			edge("role-1", "vpc-1"),
			edge("svc-1", "subnet-pub"),
			edge("svc-1", "subnet-priv"),
			edge("svc-1", "sg-web"),
			edge("svc-1", "repo-1"),
			edge("svc-1", "role-1"),
			edge("alb-1", "subnet-pub"),
			edge("alb-1", "subnet-priv"),
			edge("alb-1", "sg-web"),
			edge("alb-1", "svc-1"),
		],
	};
}

// Simple data: keep required sqs + dynamodb for tests, 6 nodes
function dataPipelineGraph(): InfrastructureGraph {
	return {
		version: 1,
		name: "data-pipeline",
		nodes: [
			{ id: "bucket-1", type: "aws_s3", config: { versioning: false } },
			{ id: "queue-1", type: "aws_sqs", config: {} },
			{ id: "table-1", type: "aws_dynamodb_table", config: { hashKey: "id" } },
			{ id: "role-1", type: "aws_iam_role", config: { assumeService: "lambda" } },
			{ id: "repo-1", type: "aws_ecr", config: {} },
			{ id: "fn-1", type: "aws_lambda", config: { runtime: "python3.13", memoryMb: 256 } },
		],
		edges: [edge("fn-1", "bucket-1"), edge("fn-1", "queue-1"), edge("fn-1", "table-1"), edge("fn-1", "role-1"), edge("fn-1", "repo-1")],
	};
}

const graphs: Record<string, BlueprintGraph> = {
	"web-app": {
		metadata: {
			id: "web-app",
			name: "Web App on EC2",
			description: "Simple public EC2 in a VPC — cheapest quick start",
			tags: ["web", "ec2", "simple", "website"],
		},
		build: webAppGraph,
	},
	"serverless-api": {
		metadata: {
			id: "serverless-api",
			name: "Serverless API",
			description: "API Gateway → single Lambda — no VPC",
			tags: ["serverless", "lambda", "api", "function"],
		},
		build: serverlessApiGraph,
	},
	"data-pipeline": {
		metadata: {
			id: "data-pipeline",
			name: "Data Pipeline",
			description: "Lambda wired to S3, SQS and DynamoDB",
			tags: ["data", "pipeline", "queue", "analytics", "etl"],
		},
		build: dataPipelineGraph,
	},
	"react-app": {
		metadata: {
			id: "react-app",
			name: "React App",
			description: "Containerized React on ECS Fargate behind ALB — subnets are AZ-fixed",
			tags: ["react", "react app", "frontend", "spa", "container", "ecs"],
		},
		build: reactAppGraph,
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

/** Build a fresh graph from a blueprint id (throws for unknown ids). */
export function buildBlueprint(id: string): InfrastructureGraph {
	const blueprint = graphs[id];
	if (!blueprint) {
		throw new Error(`Unknown blueprint "${id}"`);
	}
	return structuredClone(blueprint.build());
}
