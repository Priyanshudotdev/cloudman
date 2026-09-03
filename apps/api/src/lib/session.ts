import { getAuth } from "@my-better-t-app/auth";
import type { MiddlewareHandler } from "hono";

export type AppEnv = {
	Variables: {
		userId: string;
	};
};

/**
 * When no session is present, requests fall back to a single shared workspace
 * user so the whole product is usable without signing in. Authentication is
 * kept intact (an authenticated request still uses the real user id); this
 * simply hides the login wall rather than removing auth.
 */
export const ANON_USER_ID = "000000000000000000000000";

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
	const auth = await getAuth();
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (session?.user) {
		c.set("userId", session.user.id);
	} else {
		c.set("userId", ANON_USER_ID);
	}
	return next();
};
