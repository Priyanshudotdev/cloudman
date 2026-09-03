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
		// Cross-domain setup: the web (auth UI) and the API live on different
		// origins (e.g. web on Vercel, api on Railway). Browsers only attach a
		// SameSite=Lax cookie on same-site requests, which would drop the session
		// when the frontend calls the API cross-origin. Using SameSite=None (with
		// Secure) lets the browser send the session cookie on those cross-site
		// fetches; CORS already allows credentials for env.CORS_ORIGIN.
		sameSite: "none",
		useSecureCookies: true,
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
