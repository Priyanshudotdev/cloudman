import { env } from "@my-better-t-app/env/server";
import type { MiddlewareHandler } from "hono";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF guard for cookie-authenticated mutations.
 *
 * The session cookie is SameSite=None (required for the cross-origin web/API
 * split), which means a cross-site `<form method="POST">` auto-submit would
 * carry the victim's cookie. Several mutating routes take no body
 * (approve/cancel/retry/verify), so they are trivially forgeable that way.
 *
 * Rule: for unsafe methods, a present Origin (or Referer fallback) must match
 * the trusted web origin exactly. Requests with neither header (curl, tests,
 * server-to-server) are allowed through — they carry no ambient authority.
 */
export const csrfProtection: MiddlewareHandler = async (c, next) => {
	if (!UNSAFE_METHODS.has(c.req.method)) return next();
	// better-auth performs its own origin/trustedOrigins checks on its
	// endpoints (sign-in posts, OAuth callbacks); leave those alone.
	if (c.req.path.startsWith("/api/auth/")) return next();

	const origin =
		c.req.header("origin") ?? c.req.header("referer")?.split("/").slice(0, 3).join("/");
	if (origin === undefined) return next();

	// Exact match against the single trusted origin. Comparison is done on the
	// serialized origin (scheme + host + port), never a prefix or suffix test.
	if (origin !== env.CORS_ORIGIN) {
		return c.json({ error: "Forbidden" }, 403);
	}
	return next();
};
