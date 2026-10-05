import { getAuth } from "@my-better-t-app/auth";
import { env } from "@my-better-t-app/env/server";
import type { MiddlewareHandler } from "hono";

export type AppEnv = {
	Variables: {
		userId: string;
	};
};

/**
 * Shared workspace id used only when anon access is explicitly allowed
 * (`ALLOW_ANON=1`, local dev). Never enable in production: every
 * unauthenticated visitor would share one workspace, including stored
 * AWS role ARNs/external IDs and SSH credentials.
 */
export const ANON_USER_ID = "000000000000000000000000";

export interface RequireAuthOptions {
	/** Overrides env.ALLOW_ANON. Primarily for tests. */
	allowAnon?: boolean;
}

/**
 * Builds the session middleware. Authenticated requests always use the real
 * user id. Unauthenticated requests are rejected with 401 unless anonymous
 * access is explicitly allowed.
 */
export function createRequireAuth(
	options: RequireAuthOptions = {},
): MiddlewareHandler<AppEnv> {
	const allowAnon = options.allowAnon ?? env.ALLOW_ANON === "1";
	return async (c, next) => {
		const auth = await getAuth();
		const session = await auth.api.getSession({ headers: c.req.raw.headers });
		if (session?.user) {
			c.set("userId", session.user.id);
			return next();
		}
		if (allowAnon) {
			c.set("userId", ANON_USER_ID);
			return next();
		}
		return c.json({ error: "Unauthorized" }, 401);
	};
}

/**
 * Default middleware: a valid session is required unless ALLOW_ANON=1.
 * `/health` and `/api/auth/*` are mounted without any middleware (see app.ts)
 * and stay open.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = createRequireAuth();
