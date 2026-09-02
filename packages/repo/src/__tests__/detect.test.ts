import { describe, expect, it } from "bun:test";
import { detectStack, type RepoFileView } from "../detect";

/**
 * File-tree fixtures. `files` is a `path -> contents` map; the resulting view
 * exposes the keys as `paths` and a `getContent` for manifest reads.
 */
function view(files: Record<string, string | null>): RepoFileView {
	return {
		paths: Object.keys(files),
		getContent: (p) => files[p] ?? null,
	};
}

describe("detectStack", () => {
	it("detects Next.js static export", async () => {
		const v = view({
			"package.json":
				'{"scripts":{"build":"next build"},"dependencies":{"next":"14"}}',
			"next.config.js": "module.exports = { output: 'export' }",
			"pages/index.tsx": "",
		});
		const r = await detectStack(v);
		expect(r.stack).toBe("next-static");
		expect(r.confidence).toBeGreaterThan(0.9);
	});

	it("detects Next.js server (SSR) by default", async () => {
		const v = view({
			"package.json":
				'{"scripts":{"build":"next build"},"dependencies":{"next":"14"}}',
			"next.config.js": "module.exports = {}",
			"app/layout.tsx": "",
		});
		const r = await detectStack(v);
		expect(r.stack).toBe("next-node");
	});

	it("detects React Vite SPA", async () => {
		const v = view({
			"package.json":
				'{"scripts":{"build":"vite build"},"dependencies":{"react":"18"}}',
			"vite.config.ts": "import { defineConfig } from 'vite'",
			"index.html": "",
		});
		const r = await detectStack(v);
		expect(r.stack).toBe("react-vite");
	});

	it("detects a bare React project as a static SPA", async () => {
		const v = view({
			"package.json": '{"dependencies":{"react":"18","react-dom":"18"}}',
			"src/App.tsx": "",
		});
		const r = await detectStack(v);
		expect(r.stack).toBe("react-vite");
	});

	it("detects a Node Express service", async () => {
		const v = view({
			"package.json": '{"main":"index.js","dependencies":{"express":"4"}}',
			"index.js": "require('express')()",
		});
		const r = await detectStack(v);
		expect(r.stack).toBe("node-express");
	});

	it("detects Django via manage.py", async () => {
		const v = view({
			"manage.py": "",
			"requirements.txt": "Django==5",
			"project/wsgi.py": "",
		});
		const r = await detectStack(v);
		expect(r.stack).toBe("python-django");
	});

	it("detects Flask via app file", async () => {
		const v = view({
			"app.py": "from flask import Flask",
			"requirements.txt": "flask",
		});
		const r = await detectStack(v);
		expect(r.stack).toBe("python-flask");
	});

	it("detects a generic Python project as Flask", async () => {
		const v = view({
			"pyproject.toml": "[project]",
			"src/main.py": "",
		});
		const r = await detectStack(v);
		expect(r.stack).toBe("python-flask");
	});

	it("detects Spring Boot via pom.xml + entrypoint", async () => {
		const v = view({
			"pom.xml": "<project><artifactId>demo</artifactId></project>",
			"src/main/java/com/demo/DemoApplication.java":
				"@SpringBootApplication public class DemoApplication {}",
		});
		const r = await detectStack(v);
		expect(r.stack).toBe("springboot");
	});

	it("detects Maven build without Spring entrypoint as Spring Boot (MVP)", async () => {
		const v = view({
			"pom.xml": "<project></project>",
		});
		const r = await detectStack(v);
		expect(r.stack).toBe("springboot");
	});

	it("returns unsupported for an empty/unknown tree", async () => {
		const r = await detectStack(view({ "README.md": "" }));
		expect(r.stack).toBe("unsupported");
		expect(r.confidence).toBeNull();
	});

	it("respects a manual stack override", async () => {
		const r = await detectStack(view({ "README.md": "" }), {
			stack: "node-express",
		});
		expect(r.stack).toBe("node-express");
	});
});
