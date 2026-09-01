import { getAuth } from "@my-better-t-app/auth";
import type { MiddlewareHandler } from "hono";

export type AppEnv = {
	Variables: {
		userId: string;
	};
};

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
	const auth = await getAuth();
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session?.user) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	c.set("userId", session.user.id);
	return next();
};
