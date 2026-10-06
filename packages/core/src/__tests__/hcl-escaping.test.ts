import { describe, expect, test } from "bun:test";
import { hclEscapeFragment, hclString } from "../compiler/hcl";
import { buildIR, compileIR } from "../index";

function ecsGraph(imageTag: string) {
	return {
		version: 1,
		name: "image-tag-probe",
		nodes: [
			{ id: "vpc-1", type: "aws_vpc", config: { cidrBlock: "10.0.0.0/16" } },
			{
				id: "subnet-1",
				type: "aws_subnet",
				config: { cidrBlock: "10.0.1.0/24" },
			},
			{ id: "role-1", type: "aws_iam_role", config: {} },
			{ id: "repo-1", type: "aws_ecr", config: {} },
			{
				id: "svc-1",
				type: "aws_ecs",
				config: { imageTag, assignPublicIp: true },
			},
		],
		edges: [
			{ source: "subnet-1", target: "vpc-1" },
			{ source: "role-1", target: "vpc-1" },
			{ source: "repo-1", target: "vpc-1" },
			{ source: "svc-1", target: "vpc-1" },
			{ source: "svc-1", target: "subnet-1" },
			{ source: "svc-1", target: "role-1" },
			{ source: "svc-1", target: "repo-1" },
		],
	};
}

describe("hcl fragment escaping", () => {
	test("hclEscapeFragment keeps ${...} literal while stripping quotes", () => {
		expect(hclEscapeFragment('${file("/root/.aws/credentials")}')).toBe(
			'$${file(\\"/root/.aws/credentials\\")}',
		);
	});

	test("hclEscapeFragment agrees with hclString minus the wrapping quotes", () => {
		for (const value of ["latest", "v1.2.3", "${a}", 'q"q', "back\\slash"]) {
			expect(hclEscapeFragment(value)).toBe(hclString(value).slice(1, -1));
		}
	});

	test("a spliced ref stays live while the spliced tag stays literal", () => {
		const ref = "${aws_ecr_repository.repo-1.repository_url}";
		const spliced = `"${ref}:${hclEscapeFragment("${evil}")}"`;
		expect(spliced).toBe(
			'"${aws_ecr_repository.repo-1.repository_url}:$${evil}"',
		);
	});
});

describe("ECS imageTag cannot inject HCL", () => {
	test("rejects an interpolation payload at config validation", () => {
		const built = buildIR(ecsGraph('${file("/root/.aws/credentials")}'), {
			region: "us-east-1",
		});
		expect(built.ok).toBe(false);
		if (built.ok) return;
		expect(
			built.issues.some(
				(issue) =>
					issue.code === "INVALID_CONFIG" && issue.message.includes("imageTag"),
			),
		).toBe(true);
	});

	test.each([
		["plain", "latest"],
		["dotted", "v1.2.3"],
		["dashed", "release-2026-01"],
		["underscored", "build_7"],
		["numeric", "123"],
	])("accepts a legitimate %s tag", (_label, tag) => {
		const built = buildIR(ecsGraph(tag), { region: "us-east-1" });
		expect(built.ok).toBe(true);
	});

	test.each([
		["interpolation", '${file("/etc/passwd")}'],
		["quote break", 'a"b'],
		["brace", "${x}"],
		["newline", "a\nb"],
		["overlong", "a".repeat(129)],
	])("rejects a %s tag", (_label, tag) => {
		const built = buildIR(ecsGraph(tag), { region: "us-east-1" });
		expect(built.ok).toBe(false);
	});

	test("a valid tag still emits a live repository reference", () => {
		const built = buildIR(ecsGraph("v9"), { region: "us-east-1" });
		if (!built.ok) throw new Error("expected a valid graph");
		const out = compileIR(built.document, { bucketNameSuffix: "abc12345" });
		const main = out.find((f) => f.path === "main.tf")?.contents ?? "";
		expect(main).toContain('"${aws_ecr_repository.repo-1.repository_url}:v9"');
	});
});
