import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./session";

// NOTE: This limiter is in-memory per-process only. For multi-replica prod,
// replace with a Redis-backed sliding-window limiter (e.g. fixed window in
// Redis with Lua or a token bucket) so limits are enforced globally.

interface RateLimitOptions {
	windowMs: number;
	max: number;
	/** Max distinct keys retained before the oldest idle keys are evicted. */
	maxKeys?: number;
}

const hits = new Map<string, number[]>();

// Bound on retained keys so a caller rotating identities cannot grow the map
// without limit (each unseen key was previously kept forever).
const MAX_KEYS = 10_000;

function evictIfNeeded(windowMs: number, maxKeys: number) {
	if (hits.size <= maxKeys) return;
	// Drop keys whose newest hit is already outside the window; if that is not
	// enough, drop the oldest-inserted entries (Map preserves insertion order).
	const cutoff = Date.now() - windowMs;
	for (const [key, timestamps] of hits) {
		const newest = timestamps[timestamps.length - 1];
		if (newest === undefined || newest <= cutoff) hits.delete(key);
		if (hits.size <= maxKeys) return;
	}
	while (hits.size > maxKeys) {
		const oldest = hits.keys().next();
		if (oldest.done) break;
		hits.delete(oldest.value);
	}
}

/**
 * Identity for rate limiting.
 *
 * Prefers the authenticated user, which a caller cannot forge. Falls back to
 * the peer address. `x-forwarded-for` is deliberately NOT used: it is
 * client-controlled, so trusting it lets an attacker mint unlimited identities
 * by rotating the header and bypass every limit in the app.
 */
function clientKey(
	c: { get(key: "userId"): string | undefined },
	peerIp: string,
) {
	const userId = c.get("userId");
	if (userId) return `u:${userId}`;
	return `ip:${peerIp || "unknown"}`;
}

function peerAddress(req: Request): string {
	const raw = req as unknown as {
		socket?: { remoteAddress?: string };
		connection?: { remoteAddress?: string };
	};
	return raw.socket?.remoteAddress ?? raw.connection?.remoteAddress ?? "";
}

export function createRateLimiter(
	options: RateLimitOptions,
): MiddlewareHandler<AppEnv> {
	const { windowMs, max, maxKeys = MAX_KEYS } = options;
	return async (c, next) => {
		const key = clientKey(c, peerAddress(c.req.raw));
		const now = Date.now();
		const cutoff = now - windowMs;
		const timestamps = (hits.get(key) ?? []).filter((t) => t > cutoff);
		if (timestamps.length >= max) {
			// Re-insert so the key's position stays recent and eviction is fair.
			hits.delete(key);
			hits.set(key, timestamps);
			return c.json({ error: "Rate limit exceeded, try again later." }, 429);
		}
		timestamps.push(now);
		hits.delete(key);
		hits.set(key, timestamps);
		evictIfNeeded(windowMs, maxKeys);
		await next();
	};
}

/** Test helper: clears in-memory counters (not for production use). */
export function clearRateLimitCounters(): void {
	hits.clear();
}

/** Test helper: current number of tracked keys. */
export function rateLimitKeyCount(): number {
	return hits.size;
}
