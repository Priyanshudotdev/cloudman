import { getClient } from "@my-better-t-app/db";
import { env } from "@my-better-t-app/env/server";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";
import type { Db } from "mongodb";

export function createAuth(db: Db) {
	return betterAuth({
		database: mongodbAdapter(db),
		trustedOrigins: [env.CORS_ORIGIN],
		emailAndPassword: {
			enabled: true,
		},
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		plugins: [nextCookies()],
		// Google OAuth is optional: set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET and
		// the web sign-in button appears. Callback is `${BETTER_AUTH_URL}/api/auth/callback/google`.
		...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
			? {
					socialProviders: {
						google: {
							clientId: env.GOOGLE_CLIENT_ID,
							clientSecret: env.GOOGLE_CLIENT_SECRET,
						},
					},
				}
			: {}),
	});
}

const globalForAuth = globalThis as unknown as {
	cloudmanAuthPromise?: ReturnType<typeof initializeAuth>;
};

async function initializeAuth() {
	const db = await getClient();
	return createAuth(db);
}

export function getAuth() {
	if (!globalForAuth.cloudmanAuthPromise) {
		globalForAuth.cloudmanAuthPromise = initializeAuth();
	}
	return globalForAuth.cloudmanAuthPromise;
}