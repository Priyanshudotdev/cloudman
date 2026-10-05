import { describe, expect, test } from "bun:test";

import {
	buildIR,
	compileIR,
	exportCloudFormation,
	type InfrastructureGraph,
} from "../index";

/** CloudFormation resource Type → the HCL/Terraform kind it corresponds to. */
const CFN_TYPE_TO_HCL_KIND: Record<string, string> = {
	"AWS::EC2::VPC": "aws_vpc",
	"AWS::EC2::Subnet": "aws_subnet",
	"AWS::EC2::SecurityGroup": "aws_security_group",
	"AWS::EC2::Instance": "aws_instance",
	"AWS::S3::Bucket": "aws_s3_bucket",
	"AWS::IAM::Role": "aws_iam_role",
	"AWS::Lambda::Function": "aws_lambda_function",
	"AWS::Lambda::Permission": "aws_lambda_permission",
	"AWS::ApiGateway::RestApi": "aws_api_gateway_rest_api",
	"AWS::ApiGateway::Resource": "aws_api_gateway_resource",
	"AWS::ApiGateway::Method": "aws_api_gateway_method",
	"AWS::ApiGateway::Deployment": "aws_api_gateway_deployment",
	"AWS::ApiGateway::Stage": "aws_api_gateway_stage",
};

function representativeGraph(): InfrastructureGraph {
	return {
		version: 1,
		name: "conformance",
		nodes: [
			{ id: "vpc-1", type: "aws_vpc", config: { cidrBlock: "10.0.0.0/16" } },
			{
				id: "subnet-1",
				type: "aws_subnet",
				config: { cidrBlock: "10.0.1.0/24" },
			},
			{ id: "sg-1", type: "aws_security_group", config: {} },
			{ id: "web-1", type: "aws_ec2", config: {} },
			{ id: "data-1", type: "aws_s3", config: {} },
			{ id: "role-1", type: "aws_iam_role", config: {} },
			{
				id: "fn-1",
				type: "aws_lambda",
				config: {
					codeSource: "zip",
					s3CodeBucket: "artifacts",
					s3CodeKey: "bundle.zip",
				},
			},
			{ id: "api-1", type: "aws_apigateway", config: {} },
		],
		edges: [
			{ source: "subnet-1", target: "vpc-1" },
			{ source: "sg-1", target: "vpc-1" },
			{ source: "web-1", target: "subnet-1" },
			{ source: "web-1", target: "sg-1" },
			{ source: "fn-1", target: "role-1" },
			{ source: "api-1", target: "fn-1" },
		],
	};
}

function hclKinds(mainTf: string): string[] {
	const kinds: string[] = [];
	for (const match of mainTf.matchAll(/resource "([^"]+)" "[^"]+"/g)) {
		if (match[1]) kinds.push(match[1]);
	}
	return kinds;
}

describe("backend conformance (HCL vs CloudFormation)", () => {
	test("compileIR and exportCloudFormation cover the same logical resources", () => {
		const built = buildIR(representativeGraph(), { region: "us-east-1" });
		if (!built.ok) throw new Error(JSON.stringify(built.issues));

		const files = compileIR(built.document, { bucketNameSuffix: "ab12cd" });
		const mainTf = files.find((f) => f.path === "main.tf")?.contents ?? "";
		const hcl = hclKinds(mainTf);
		expect(hcl.length).toBeGreaterThan(0);

		const template = JSON.parse(exportCloudFormation(built.document)) as {
			Resources: Record<string, { Type: string }>;
		};
		const cfnTypes = Object.values(template.Resources).map((r) => r.Type);
		expect(cfnTypes.length).toBeGreaterThan(0);

		// Every CFN resource must map to a known HCL kind present in main.tf.
		const cfnKinds = cfnTypes.map((type) => {
			const kind = CFN_TYPE_TO_HCL_KIND[type];
			expect(kind, `CFN type ${type} has no HCL kind mapping`).toBeDefined();
			return kind as string;
		});
		for (const kind of new Set(cfnKinds)) {
			expect(hcl, `HCL output should contain kind ${kind}`).toContain(kind);
		}

		// Per-kind counts must agree between the two backends, except for the
		// API Gateway integration which HCL emits as its own resource while
		// CloudFormation inlines it on the Method.
		const countBy = (kinds: string[]): Map<string, number> => {
			const counts = new Map<string, number>();
			for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
			return counts;
		};
		const hclCounts = countBy(hcl);
		const cfnCounts = countBy(cfnKinds);
		for (const [kind, count] of cfnCounts) {
			expect(
				hclCounts.get(kind) ?? 0,
				`kind ${kind}: HCL count should match CFN count`,
			).toBe(count);
		}
		const unmappedHcl = [...hclCounts.entries()].filter(
			([kind]) =>
				!Object.values(CFN_TYPE_TO_HCL_KIND).includes(kind) &&
				kind !== "aws_api_gateway_integration",
		);
		expect(unmappedHcl).toEqual([]);
		expect(hcl.length).toBe(cfnKinds.length + 1);
	});
});
