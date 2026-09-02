import type { BuildRecipe, DetectedStack, OverrideConfig } from "./types";

/**
 * Per-stack build recipes. Each entry describes exactly how to install deps,
 * build the app, which artifact paths to ship to the host, and how the
 * resulting process is supervised once it's there.
 *
 * These are the single source of truth that both deployment drivers consume:
 * the SSH driver runs install/build and ships the artifacts; the AWS-IaC driver
 * maps the runtime shape on to compute resources (service -> ECS/EC2, static ->
 * S3+CloudFront).
 */

function applyOverrides(
	base: BuildRecipe,
	overrides: OverrideConfig | undefined,
): BuildRecipe {
	if (!overrides) return base;
	return {
		...base,
		...(overrides.installCommand
			? { installCommand: overrides.installCommand }
			: {}),
		...(overrides.buildCommand ? { buildCommand: overrides.buildCommand } : {}),
		...(overrides.exposedPort !== undefined
			? { exposedPort: overrides.exposedPort }
			: {}),
	};
}

function staticRecipe(
	stack: DetectedStack,
	label: string,
	install: string,
	build: string,
	baseDir: string,
): BuildRecipe {
	return {
		stack,
		label,
		processType: "static",
		installCommand: install,
		buildCommand: build,
		artifacts: [baseDir],
		runtimeShape: { kind: "static", baseDir },
		startCommand: null,
		exposedPort: 0,
		pkgManager: null,
	};
}

const RECIPES: Record<Exclude<DetectedStack, "unsupported">, BuildRecipe> = {
	"next-static": staticRecipe(
		"next-static",
		"Next.js (static export)",
		"npm ci",
		"npm run build",
		"out",
	),
	"react-vite": staticRecipe(
		"react-vite",
		"React (Vite SPA)",
		"npm ci",
		"npm run build",
		"dist",
	),
	"next-node": {
		stack: "next-node",
		label: "Next.js (server)",
		processType: "systemd",
		installCommand: "npm ci",
		buildCommand: "npm run build",
		// Next ships the whole project (node_modules + .next) to the host so the
		// server can `next start` in place.
		artifacts: [".", "-node_modules/.cache"],
		runtimeShape: { kind: "service", baseDir: ".", entryFile: "next start" },
		startCommand: "next start -p $PORT",
		exposedPort: 3000,
		pkgManager: "npm",
	},
	"node-express": {
		stack: "node-express",
		label: "Node service",
		processType: "pm2",
		installCommand: "npm ci --omit=dev",
		buildCommand: null,
		artifacts: [".", "-node_modules/.cache"],
		runtimeShape: { kind: "service", baseDir: ".", entryFile: "npm start" },
		startCommand: "npm start",
		exposedPort: 3000,
		pkgManager: "npm",
	},
	"python-flask": {
		stack: "python-flask",
		label: "Python Flask",
		processType: "systemd",
		installCommand: "pip install -r requirements.txt",
		buildCommand: null,
		artifacts: [".", "-.venv", "-__pycache__"],
		runtimeShape: {
			kind: "service",
			baseDir: ".",
			entryFile: "gunicorn app:app",
		},
		startCommand: "gunicorn --bind 0.0.0.0:$PORT app:app",
		exposedPort: 5000,
		pkgManager: "pip",
	},
	"python-django": {
		stack: "python-django",
		label: "Python Django",
		processType: "systemd",
		installCommand: "pip install -r requirements.txt",
		buildCommand: "python manage.py collectstatic --noinput",
		artifacts: [".", "-.venv", "-__pycache__"],
		runtimeShape: {
			kind: "service",
			baseDir: ".",
			entryFile: "gunicorn project.wsgi",
		},
		startCommand: "gunicorn --bind 0.0.0.0:$PORT project.wsgi:application",
		exposedPort: 8000,
		pkgManager: "pip",
	},
	springboot: {
		stack: "springboot",
		label: "Spring Boot",
		processType: "systemd",
		installCommand: "",
		buildCommand: "mvn -q -DskipTests package",
		artifacts: ["target/*.jar"],
		runtimeShape: {
			kind: "service",
			baseDir: "target",
			entryFile: "java -jar app.jar",
		},
		startCommand: "java -jar $APP_JAR",
		exposedPort: 8080,
		pkgManager: "maven",
	},
};

/** Build recipe for a detected stack; `unsupported` returns null. */
export function buildRecipe(
	stack: DetectedStack,
	overrides?: OverrideConfig,
): BuildRecipe | null {
	if (stack === "unsupported") return null;
	return applyOverrides(RECIPES[stack], overrides);
}

/** Validate an artifact spec entry: must be a relative, non-escaped path. */
export function artifactPaths(recipe: BuildRecipe): readonly string[] {
	const list: string[] = [];
	for (const spec of recipe.artifacts) {
		if (spec.startsWith("-")) {
			// Exclusion marker (e.g. "-node_modules/.cache"): not an inclusive glob.
			continue;
		}
		if (spec.includes("..")) continue;
		if (spec !== "." && spec.startsWith("/")) continue;
		list.push(spec);
	}
	return list;
}
