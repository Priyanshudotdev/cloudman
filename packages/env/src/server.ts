import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

function getVercelOrigin() {
	const vercelUrl =
		process.env.VERCEL_ENV === "production"
			? (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL)
			: (process.env.VERCEL_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL);
	if (!vercelUrl) return undefined;
	return vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
}

const vercelOrigin = getVercelOrigin();

const runtimeEnv = {
	...process.env,
	BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? vercelOrigin,
	CORS_ORIGIN: process.env.CORS_ORIGIN ?? vercelOrigin,
};

export const env = createEnv({
	server: {
		DATABASE_URL: z.string().min(1),
		BETTER_AUTH_SECRET: z.string().min(32),
		BETTER_AUTH_URL: z.url(),
		CORS_ORIGIN: z.url(),
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		REDIS_URL: z.url().default("redis://localhost:6379"),
		PORT: z.coerce.number().int().positive().default(4000),
		AWS_REGION: z.string().min(1).default("us-east-1"),
		AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
		AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
		/** AES-256-GCM key (hex, 32 bytes) used to encrypt AWS connection secrets at rest. */
		CLOUDMAN_SECRET: z
			.string()
			.regex(/^[0-9a-fA-F]{64}$/)
			.optional(),
		/** Google OAuth — optional; the Google login button is hidden until set. */
		GOOGLE_CLIENT_ID: z.string().min(1).optional(),
		GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
	},
	runtimeEnv: runtimeEnv,
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	emptyStringAsUndefined: true,
});
