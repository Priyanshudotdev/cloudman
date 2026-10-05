import type { MiddlewareHandler } from "hono";

// NOTE: This limiter is in-memory per-process only. For multi-replica prod,
// replace with a Redis-backed sliding-window limiter (e.g. fixed window in
// Redis with Lua or a token bucket) so limits are enforced globally.

interface RateLimitOptions {
	windowMs: number;
	max: number;
}

const hits = new Map<string, number[]>();

function clientKey(
	headerValue: string | undefined,
	remoteAddr: string,
): string {
	const forwarded = headerValue?.split(",")[0]?.trim();
	if (forwarded) return forwarded;
	if (remoteAddr) return remoteAddr;
	return "anon";
}

export function createRateLimiter(
	options: RateLimitOptions,
): MiddlewareHandler {
	const { windowMs, max } = options;
	return async (c, next) => {
		const forwarded = c.req.header("x-forwarded-for");
		// Hono's raw Request has no stable remote-addr accessor across runtimes;
		// fall back to "anon" when no forwarding header is present.
		const remoteAddr =
			(c.req.raw as unknown as { socket?: { remoteAddress?: string } })?.socket
				?.remoteAddress ?? "anon";
		const key = clientKey(forwarded, remoteAddr);
		const now = Date.now();
		const cutoff = now - windowMs;
		const timestamps = (hits.get(key) ?? []).filter((t) => t > cutoff);
		if (timestamps.length >= max) {
			return c.json({ error: "Rate limit exceeded, try again later." }, 429);
		}
		timestamps.push(now);
		hits.set(key, timestamps);
		await next();
	};
}

/** Test helper: clears in-memory counters (not for production use). */
export function clearRateLimitCounters(): void {
	hits.clear();
}
