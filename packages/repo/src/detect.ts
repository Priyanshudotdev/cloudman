import type { DetectedStack, DetectionResult } from "./types";

/**
 * Minimal view of a cloned repository's file tree used for detection.
 * Implementations can back this with an actual git ls-tree, a real directory
 * walk, or an in-memory fixture — detection never touches the disk itself.
 */
export interface RepoFileView {
	/** Every path in the tree (relative, POSIX separators, no leading `/`). */
	readonly paths: readonly string[];
	/** Read a file's contents when needed (only for manifests). */
	readonly getContent?: (
		path: string,
	) => string | null | Promise<string | null>;
}

export interface DetectOptions {
	/** Optional user override that short-circuits auto-detection. */
	readonly stack?: DetectedStack;
}

const has = (paths: readonly string[], p: string): boolean =>
	paths.some((x) => x === p);

const hasAny = (paths: readonly string[], names: readonly string[]): boolean =>
	names.some((n) => has(paths, n));

/** Case-sensitive glob for a single relative path (supports a leading * / prefix). */
function globOnce(paths: readonly string[], pattern: string): boolean {
	const root = pattern.replace(/^\*\//, "");
	const slash = "/" + root;
	return paths.some((p) => p === root || p.endsWith(slash));
}

/** Read and JSON-parse a file if present (returns null on parse failure/gap). */
async function readJson(
	view: RepoFileView,
	path: string,
): Promise<Record<string, unknown> | null> {
	const content = view.getContent?.(path);
	if (content === undefined) return null;
	const raw = typeof content === "string" ? content : await content;
	if (!raw) return null;
	try {
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return null;
	}
}

async function hasDep(
	view: RepoFileView,
	path: string,
	name: string,
): Promise<boolean> {
	const json = await readJson(view, path);
	if (!json) return false;
	for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
		const deps = json[key];
		if (deps && typeof deps === "object" && name in deps) return true;
	}
	return false;
}

async function hasNextStaticExport(view: RepoFileView): Promise<boolean> {
	for (const c of ["next.config.js", "next.config.mjs", "next.config.ts"]) {
		const raw = view.getContent?.(c);
		if (raw === undefined) continue;
		const content = typeof raw === "string" ? raw : await raw;
		if (content && /output\s*:\s*["']export["']/.test(content)) return true;
	}
	return false;
}

function hasNodeServerEntry(
	view: RepoFileView,
	pkg: Record<string, unknown>,
): boolean {
	if (typeof pkg["main"] === "string" && /^[^/]+\.[jt]s$/.test(pkg["main"])) {
		const base = (pkg["main"] as string).replace(/\.([jt]s)$/, ".js");
		if (has(view.paths, base)) return true;
	}
	const scripts = pkg["scripts"];
	if (
		scripts &&
		typeof scripts === "object" &&
		typeof (scripts as Record<string, unknown>)["start"] === "string"
	) {
		return true;
	}
	return false;
}

/**
 * Detect which stack a repository is. Order-sensitive by design: the most
 * specific markers (Django manage.py, Spring entrypoint) resolve before more
 * generic ones, and Next's static-vs-node split reads the config file.
 */
export async function detectStack(
	view: RepoFileView,
	options: DetectOptions = {},
): Promise<DetectionResult> {
	const paths = view.paths;

	if (options.stack) {
		return resolved(
			options.stack,
			"Manually overridden to " + options.stack + ".",
			[],
		);
	}

	// --- Python / Django ---
	if (globOnce(paths, "manage.py")) {
		return resolved("python-django", "Django detected — manage.py present.", [
			"manage.py",
		]);
	}

	// --- Python / Flask ---
	const hasFlaskFile = paths.some((p) => /flask[^/]*\.py$/i.test(p));
	const hasPyManifest =
		hasAny(paths, ["requirements.txt", "Pipfile", "pipfile.lock"]) ||
		globOnce(paths, "pyproject.toml");
	if (hasFlaskFile || hasPyManifest) {
		return resolved(
			"python-flask",
			hasFlaskFile
				? "Flask app file detected."
				: "Python project detected via manifest; defaulting to Flask.",
			hasFlaskFile
				? paths.filter((p) => /flask[^/]*\.py$/i.test(p))
				: ["pyproject.toml"],
		);
	}

	// --- JVM / Spring Boot ---
	const hasMaven = globOnce(paths, "pom.xml");
	const hasGradle = hasAny(paths, [
		"build.gradle",
		"build.gradle.kts",
		"settings.gradle",
	]);
	const hasSpringEntry = paths.some((p) =>
		/src\/main\/java\/.*Application\.java$/.test(p),
	);
	if (hasMaven || hasGradle) {
		return resolved(
			"springboot",
			hasSpringEntry
				? "Spring Boot entrypoint under src/main/java."
				: "JVM build file detected; assuming Spring Boot for the MVP.",
			[hasMaven ? "pom.xml" : "build.gradle"],
		);
	}

	// --- JavaScript / TypeScript ---
	if (has(paths, "package.json")) {
		const isNext = hasAny(paths, [
			"next.config.js",
			"next.config.mjs",
			"next.config.ts",
		]);
		const isVite =
			globOnce(paths, "vite.config.js") ||
			globOnce(paths, "vite.config.mjs") ||
			globOnce(paths, "vite.config.ts");
		const hasReact = await hasDep(view, "package.json", "react");

		if (isNext) {
			const staticExport = await hasNextStaticExport(view);
			return resolved(
				staticExport ? "next-static" : "next-node",
				staticExport
					? "Next.js with output: export — hosting statically."
					: "Next.js detected — hosting as a Node server (SSR).",
				["next.config.js", "package.json"],
			);
		}
		if (isVite) {
			return resolved(
				"react-vite",
				"Vite project detected — hosting as a static SPA.",
				["vite.config.ts"],
			);
		}
		if (hasReact) {
			return resolved(
				"react-vite",
				"React project without Vite/Next — treating as a static SPA.",
				["package.json"],
			);
		}
		const pkg = (await readJson(view, "package.json")) ?? {};
		if (await hasNodeServerEntry(view, pkg)) {
			return resolved("node-express", "Node HTTP service detected.", [
				"package.json",
			]);
		}
	}

	return {
		stack: "unsupported",
		confidence: null,
		reason:
			"No recognizable application manifest found (searched package.json, requirements.txt, Pipfile, pyproject.toml, manage.py, pom.xml, build.gradle).",
		markers: [],
	};
}

function resolved(
	stack: DetectedStack,
	reason: string,
	markers: readonly string[],
): DetectionResult {
	const confidence =
		stack === "next-static" || stack === "next-node"
			? 0.95
			: stack === "react-vite"
				? 0.9
				: stack === "python-django"
					? 0.92
					: stack === "python-flask"
						? 0.85
						: stack === "springboot"
							? 0.88
							: stack === "node-express"
								? 0.8
								: null;
	return { stack, confidence, reason, markers };
}
