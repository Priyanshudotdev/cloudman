import { describe, expect, test } from "bun:test";

import {
	buildBlueprint,
	buildIR,
	generateGraphFromPrompt,
	listBlueprints,
} from "../index";

describe("listBlueprints", () => {
	test("advertises curated stack templates", () => {
		const ids = listBlueprints().map((b) => b.id);
		expect(ids).toContain("web-app");
		expect(ids).toContain("serverless-api");
		expect(ids).toContain("data-pipeline");
		expect(ids).toContain("react-app");
		for (const b of listBlueprints()) {
			expect(b.tags.length).toBeGreaterThan(0);
			expect(b.description.length).toBeGreaterThan(0);
		}
	});
});

describe("buildBlueprint", () => {
	test("loads a fresh graph by id", () => {
		const graph = buildBlueprint("react-app");
		const types = graph.nodes.map((n) => n.type);
		expect(types).toContain("aws_ecs");
		expect(types).toContain("aws_alb");
		expect(types).toContain("aws_ecr");
		expect(graph.edges.length).toBeGreaterThan(0);
	});

	test("throws for unknown ids", () => {
		expect(() => buildBlueprint("does-not-exist")).toThrow();
	});

	test("react-app template matches a react/frontend prompt", () => {
		const result = generateGraphFromPrompt("deploy my react app");
		expect(result.blueprint).toBe("react-app");
	});
});

describe("generateGraphFromPrompt", () => {
	test("matches a serverless prompt to the serverless-api template", () => {
		const result = generateGraphFromPrompt(
			"I want a serverless api gateway and lambda",
		);
		expect(result.blueprint).toBe("serverless-api");
		const types = result.graph.nodes.map((n) => n.type);
		expect(types).toContain("aws_lambda");
		expect(types).toContain("aws_apigateway");
	});

	test("matches an etl/data prompt to the data-pipeline template", () => {
		const result = generateGraphFromPrompt(
			"batch etl data pipeline with a queue",
		);
		expect(result.blueprint).toBe("data-pipeline");
		const types = result.graph.nodes.map((n) => n.type);
		expect(types).toContain("aws_sqs");
		expect(types).toContain("aws_dynamodb_table");
	});

	test("falls back to web-app for unrecognized prompts", () => {
		const result = generateGraphFromPrompt("mystery stack plz");
		expect(result.blueprint).toBe("web-app");
		expect(result.warnings.length).toBeGreaterThan(0);
	});

	test("returns a fresh copy each call so callers can mutate", () => {
		const a = generateGraphFromPrompt("web app");
		const b = generateGraphFromPrompt("web app");
		const first = a.graph.nodes[0];
		const second = b.graph.nodes[0];
		expect(first).not.toBe(second);
		expect(first?.config).not.toBe(second?.config);
		expect(a.graph).toEqual(b.graph);
	});

	test("set graph name is sanitized from the prompt", () => {
		const result = generateGraphFromPrompt("  My Web Stack  ");
		expect(result.graph.name).toContain("-");
	});

	test("every blueprint template compiles to a valid IR document", () => {
		for (const blueprint of listBlueprints()) {
			const result = generateGraphFromPrompt(blueprint.tags[0] ?? blueprint.id);
			const built = buildIR(result.graph);
			expect(
				built.ok,
				`blueprint "${blueprint.id}" should build: ${
					built.ok ? "" : built.issues.map((i) => i.code).join(", ")
				}`,
			).toBe(true);
			if (!built.ok) continue;
			expect(built.document.resources.length).toBeGreaterThan(0);
		}
	});
});
