import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
	client: {
		NEXT_PUBLIC_API_URL: z.url().default("http://localhost:4000"),
		NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED: z
			.enum(["true", "false"])
			.default("false"),
	},
	runtimeEnv: {
		NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
		NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED:
			process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED,
	},
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	emptyStringAsUndefined: true,
});
