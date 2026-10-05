import { describe, expect, it } from "bun:test";
import { artifactPaths, buildRecipe } from "../builders";

describe("buildRecipe", () => {
	it("returns null for unsupported stack", () => {
		expect(buildRecipe("unsupported")).toBeNull();
	});

	it("provides a systemd recipe for Next server", () => {
		const r = buildRecipe("next-node");
		expect(r).not.toBeNull();
		expect(r!.processType).toBe("systemd");
		expect(r!.exposedPort).toBe(3000);
	});

	it("provides a pm2 recipe for Node service", () => {
		const r = buildRecipe("node-express");
		expect(r!.processType).toBe("pm2");
		expect(r!.startCommand).toContain("npm start");
	});

	it("provides a static recipe for Vite", () => {
		const r = buildRecipe("react-vite");
		expect(r!.processType).toBe("static");
		expect(r!.runtimeShape).toEqual({ kind: "static", baseDir: "dist" });
	});

	it("applies overrides", () => {
		const r = buildRecipe("node-express", {
			exposedPort: 4000,
			installCommand: "npm ci --production",
		});
		expect(r!.exposedPort).toBe(4000);
		expect(r!.installCommand).toBe("npm ci --production");
	});

	it("uses stack override as manual classification", () => {
		const r = buildRecipe("react-vite", { stack: "next-node" });
		expect(r!.stack).toBe("next-node");
		expect(r!.processType).toBe("systemd");
	});

	it("returns null when stack override is unsupported", () => {
		expect(buildRecipe("react-vite", { stack: "unsupported" })).toBeNull();
	});

	it("forces next-node to static when forceStatic is set", () => {
		const r = buildRecipe("next-node", { forceStatic: true });
		expect(r).not.toBeNull();
		expect(r!.processType).toBe("static");
	});

	it("keeps already-static recipes static when forceStatic is set", () => {
		const r = buildRecipe("react-vite", { forceStatic: true });
		expect(r).not.toBeNull();
		expect(r!.processType).toBe("static");
	});

	it("returns null when forceStatic is set for server-only stacks", () => {
		expect(buildRecipe("python-flask", { forceStatic: true })).toBeNull();
		expect(buildRecipe("node-express", { forceStatic: true })).toBeNull();
		expect(buildRecipe("springboot", { forceStatic: true })).toBeNull();
	});
});

describe("artifactPaths", () => {
	it("expands inclusive globs and drops exclusions", () => {
		const r = buildRecipe("next-node")!;
		const paths = artifactPaths(r);
		// "." is kept as the whole-project ship marker; "-node_modules/.cache"
		// is an exclusion and must be dropped.
		expect(paths).toEqual(["."]);
	});

	it("filters out path-traversal / absolute specs", () => {
		const r: ReturnType<typeof buildRecipe> = {
			...buildRecipe("next-node")!,
			artifacts: ["dist", "../evil", "/abs", "safe"],
		};
		expect(artifactPaths(r!)).toEqual(["dist", "safe"]);
	});
});
