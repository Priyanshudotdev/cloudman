import { artifactPaths, buildRecipe } from "./builders";
import type {
	DeployPlan,
	DetectedStack,
	OverrideConfig,
	RepoDeploySummary,
} from "./types";

/**
 * Pure plan shaping. A driver (SSH or AWS-IaC) supplies the repository facts
 * (commit, branch, url), the detected stack, and — where available — the list
 * of files that changed since the last deploy. From those it produces the
 * concrete, serializable `DeployPlan` that the rest of the pipeline executes.
 */

export interface PlanInput {
	readonly repoUrl: string;
	readonly branch: string;
	readonly commit: string;
	readonly stack: DetectedStack;
	readonly overrides?: OverrideConfig;
	/** Files changed vs. the previous deploy (path only). Optional. */
	readonly changedFiles?: readonly string[];
	/** Deployed URL, if known up-front. */
	readonly url?: string | null;
}

export interface PlanResult {
	readonly plan: DeployPlan | null;
	readonly error: string | null;
}

export function shapePlan(input: PlanInput): PlanResult {
	const recipe = buildRecipe(input.stack, input.overrides);
	if (!recipe) {
		return {
			plan: null,
			error: `Stack "${input.stack}" is unsupported — no build recipe available.`,
		};
	}
	const plan: DeployPlan = {
		commit: input.commit,
		branch: input.branch,
		repoUrl: input.repoUrl,
		stack: input.stack,
		recipe,
		artifacts: artifactPaths(recipe),
		url: input.url ?? null,
		pinned: [],
	};
	return { plan, error: null };
}

/**
 * Compute a deploy summary comparing the artifacts of this plan against a
 * previous deploy's artifacts. `changedFiles` (a git diff) is the authoritative
 * source for what actually changed on disk; artifact statuses are derived from
 * it so the history UI can show created/updated/unchanged accurately.
 */
export function summarize(
	plan: DeployPlan,
	previous: {
		readonly commit: string | null;
		readonly artifacts: readonly string[];
	},
	availableChangedFiles: readonly string[],
): RepoDeploySummary {
	const current = plan.artifacts;
	const prev = previous.artifacts;
	const changed = [...availableChangedFiles];

	const firstDeploy = previous.commit === null;

	// An artifact is "created" when it did not exist in the previous deploy.
	const created = current.filter((a) => !prev.includes(a)).length;

	// An artifact is "updated" when the diff touches a path inside it. For
	// coarse artifacts like "." we conservatively treat any change as an update.
	let updated = 0;
	const updatedSet = new Set<string>();
	for (const file of changed) {
		for (const artifact of current) {
			if (updatedSet.has(artifact)) continue;
			if (
				artifact === "." ||
				file === artifact ||
				file.startsWith(`${artifact}/`)
			) {
				updatedSet.add(artifact);
			}
		}
	}
	if (!firstDeploy) updated = updatedSet.size;

	// Everything left over that didn't change.
	const unchanged = firstDeploy
		? 0
		: Math.max(0, current.length - created - updated);

	return {
		artifacts: current,
		changed,
		created,
		updated,
		unchanged,
	};
}
