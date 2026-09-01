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
