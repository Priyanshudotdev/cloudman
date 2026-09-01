import { describe, expect, it } from "bun:test";
import { shapePlan, summarize } from "../planner";

const base = {
	repoUrl: "https://github.com/org/app",
	branch: "main",
	commit: "abc123",
};

describe("shapePlan", () => {
	it("builds a plan for a detected stack", () => {
		const r = shapePlan({ ...base, stack: "react-vite" });
		expect(r.error).toBeNull();
		expect(r.plan).not.toBeNull();
		expect(r.plan!.artifacts).toEqual(["dist"]);
		expect(r.plan!.stack).toBe("react-vite");
	});

	it("returns an error for unsupported stacks", () => {
		const r = shapePlan({ ...base, stack: "unsupported" });
		expect(r.plan).toBeNull();
		expect(r.error).toContain("unsupported");
	});

	it("carries a url through", () => {
		const r = shapePlan({
			...base,
			stack: "node-express",
			url: "http://1.2.3.4",
		});
		expect(r.plan!.url).toBe("http://1.2.3.4");
	});
});

describe("summarize", () => {
	const plan = shapePlan({ ...base, stack: "react-vite" }).plan!;

	it("classifies a first deploy as all-created", () => {
		const s = summarize(plan, { commit: null, artifacts: [] }, []);
		expect(s.created).toBe(1);
		expect(s.updated).toBe(0);
		expect(s.unchanged).toBe(0);
	});

	it("counts changed files that touch an artifact as updates", () => {
		const s = summarize(plan, { commit: "prev", artifacts: ["dist"] }, [
			"dist/index.html",
			"src/App.tsx",
		]);
		expect(s.created).toBe(0);
		expect(s.updated).toBe(1);
		expect(s.unchanged).toBe(0);
	});
});
