import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		DATABASE_URL: z.string().min(1),
		REDIS_URL: z.url().default("redis://localhost:6379"),
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		AWS_REGION: z.string().min(1).default("us-east-1"),
		AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
		AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
		/** "1" simulates tofu execution without touching real infrastructure. */
		CLOUDMAN_WORKER_MOCK: z.enum(["0", "1"]).default("0"),
		/** Explicit path to the tofu binary; otherwise resolved from PATH. */
		TOFU_PATH: z.string().min(1).optional(),
		/** Auto-download OpenTofu into ~/.cloudman/bin when missing from PATH. */
		CLOUDMAN_TOFU_AUTOINSTALL: z.enum(["0", "1"]).default("0"),
		/** Root directory for per-deployment workspaces. */
		CLOUDMAN_WORKSPACE_ROOT: z.string().min(1).optional(),
		/** "0" keeps OpenTofu state in the local workspace instead of an S3 bucket. */
		CLOUDMAN_REMOTE_STATE: z.enum(["0", "1"]).default("1"),
		/** AES-256-GCM key (hex, 32 bytes) used to encrypt AWS connection secrets at rest. */
		CLOUDMAN_SECRET: z
			.string()
			.regex(/^[0-9a-fA-F]{64}$/)
			.optional(),
	},
	runtimeEnv: process.env,
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	emptyStringAsUndefined: true,
});
