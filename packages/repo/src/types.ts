/**
 * Shared domain model for "deploy an application from a git repository".
 *
 * This package is deliberately free of I/O (no git/ssh/docker/fs calls) so it
 * can be unit-tested in isolation and consumed by every deployment driver:
 *   - the agentless-SSH driver (deploy straight to a user's server/IP), and
 *   - the AWS-IaC driver (synthesize ECS/ECR/S3/CloudFront from the same repo).
 *
 * The detector + builder + planner below produce a normalized, driver-agnostic
 * description of what a repository is and how to run it. Drivers map that
 * description onto their own execution primitives (SSH commands, IaC resources,
 * a container build, ...).
 */

/** The normalized application stacks CloudMan can build and host. */
export type DetectedStack =
	| "next-static" // Next.js with `output: export` -> static host
	| "next-node" // Next.js server (SSR) -> node HTTP service
	| "react-vite" // Vite SPA -> static host
	| "node-express" // Node HTTP service (express/fastify/hapi)
	| "python-flask" // Flask service
	| "python-django" // Django service
	| "springboot" // JVM service via Maven/Gradle
	| "unsupported"; // recognized tree, but no buildable app found

/** How a long-running process should be supervised on the host. */
export type ProcessType = "systemd" | "pm2" | "static";

/** Where the app actually lives after a build, for artifact targeting. */
export type RuntimeShape =
	| { kind: "static"; baseDir: string; entryFile?: never }
	| { kind: "service"; baseDir: string; entryFile: string };

/**
 * A per-stack description of how to install deps, build, and what artifacts to
 * ship to the host. Entries are additive — adding a stack is a table row here
 * plus a detector rule in `detect.ts`.
 */
export interface BuildRecipe {
	readonly stack: DetectedStack;
	/** Human label surfaced in the UI. */
	readonly label: string;
	/** Package manager / toolchain used to install dependencies. */
	readonly processType: ProcessType;
	/** Shell command to install dependencies (run in the clone dir). */
	readonly installCommand: string;
	/** Shell command to build the app (run in the clone dir). */
	readonly buildCommand: string | null;
	/** Relative paths (no leading slash, no `..`, no symlink escapes) of the
	 *  build output to ship to the host. Only these are shipped — never the
	 *  whole repo — so source secrets stay off the host. */
	readonly artifacts: readonly string[];
	/** How the process runs once artifacts are on the host. */
	readonly runtimeShape: RuntimeShape;
	/** Command to start the built service (for `service` shapes). */
	readonly startCommand: string | null;
	/** The TCP port the service listens on. */
	readonly exposedPort: number;
	/** The build tool should be invoked with its package manager. */
	readonly pkgManager: "npm" | "pip" | "poetry" | "maven" | "gradle" | null;
}

/** Driver-agnostic result of scanning a cloned repository's file tree. */
export interface DetectionResult {
	/** Which stack was identified (or `unsupported`). */
	readonly stack: DetectedStack;
	/** Confidence heuristic from 0..1, or null when unsupported. */
	readonly confidence: number | null;
	/** Human-readable explanation of what was found / why it matched. */
	readonly reason: string;
	/** Relevant markers found in the tree (e.g. `package.json`, `vite.config.ts`). */
	readonly markers: readonly string[];
}

/** Optional user overrides that win over auto-detection. */
export interface OverrideConfig {
	readonly stack?: DetectedStack;
	/** Force the app to be hosted statically even if it could run as a service. */
	readonly forceStatic?: boolean;
	readonly buildCommand?: string;
	readonly installCommand?: string;
	/** Override the port the service exposes. */
	readonly exposedPort?: number;
}

/** The concrete, verified plan the deploy driver executes. */
export interface DeployPlan {
	readonly commit: string;
	readonly branch: string;
	readonly repoUrl: string;
	readonly stack: DetectedStack;
	readonly recipe: BuildRecipe;
	/** Resolved runtime artifact list after `artifactPaths()` expansion. */
	readonly artifacts: readonly string[];
	/** Public URL the app will be reachable at (after deploy completes). */
	readonly url: string | null;
	/** Package/version items pinned from the lockfile, for the record. */
	readonly pinned: ReadonlyArray<{ name: string; version: string }>;
}

/** A serializable summary stored alongside a repo deployment for history. */
export interface RepoDeploySummary {
	readonly artifacts: readonly string[];
	/** All files changed since the previous deploy (path only). */
	readonly changed: readonly string[];
	created: number;
	updated: number;
	unchanged: number;
}

/** Which deployment driver a repo plan is destined for. */
export type DriverTarget = "ssh" | "aws-iac";
