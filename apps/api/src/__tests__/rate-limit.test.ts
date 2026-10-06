import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
	clearRateLimitCounters,
	createRateLimiter,
	rateLimitKeyCount,
} from "../lib/rate-limit";
import type { AppEnv } from "../lib/session";

describe("rate limiter", () => {
	test("blocks once max is exceeded for one user", async () => {
		clearRateLimitCounters();
		const keyed = new Hono<AppEnv>();
		keyed.use("*", async (c, next) => {
			c.set("userId", "user-a");
			await next();
		});
		keyed.get("/probe", createRateLimiter({ windowMs: 60_000, max: 3 }), (c) =>
			c.json({ ok: true }),
		);

		const statuses: number[] = [];
		for (let i = 0; i < 5; i++) {
			statuses.push((await keyed.request("/probe")).status);
		}
		expect(statuses).toEqual([200, 200, 200, 429, 429]);
	});

	test("rotating x-forwarded-for does not create new identities", async () => {
		clearRateLimitCounters();
		const app = new Hono<AppEnv>();
		app.use("*", async (c, next) => {
			c.set("userId", "user-rot");
			await next();
		});
		app.get("/probe", createRateLimiter({ windowMs: 60_000, max: 2 }), (c) =>
			c.json({ ok: true }),
		);

		const statuses: number[] = [];
		for (let i = 0; i < 6; i++) {
			const res = await app.request("/probe", {
				headers: { "x-forwarded-for": `10.0.0.${i}` },
			});
			statuses.push(res.status);
		}
		// Same authenticated user regardless of the rotating header.
		expect(statuses.filter((s) => s === 429).length).toBe(4);
		expect(rateLimitKeyCount()).toBe(1);
	});

	test("distinct users get independent budgets", async () => {
		clearRateLimitCounters();
		const app = new Hono<AppEnv>();
		let current = "user-1";
		app.use("*", async (c, next) => {
			c.set("userId", current);
			await next();
		});
		app.get("/probe", createRateLimiter({ windowMs: 60_000, max: 1 }), (c) =>
			c.json({ ok: true }),
		);

		expect((await app.request("/probe")).status).toBe(200);
		expect((await app.request("/probe")).status).toBe(429);
		current = "user-2";
		expect((await app.request("/probe")).status).toBe(200);
		expect(rateLimitKeyCount()).toBe(2);
	});

	test("the key map stays bounded under identity flooding", async () => {
		clearRateLimitCounters();
		const app = new Hono<AppEnv>();
		let current = "seed";
		app.use("*", async (c, next) => {
			c.set("userId", current);
			await next();
		});
		app.get(
			"/probe",
			createRateLimiter({ windowMs: 60_000, max: 5, maxKeys: 50 }),
			(c) => c.json({ ok: true }),
		);

		for (let i = 0; i < 500; i++) {
			current = `flood-${i}`;
			await app.request("/probe");
		}
		expect(rateLimitKeyCount()).toBeLessThanOrEqual(50);
	});

	test("clearRateLimitCounters resets state", () => {
		clearRateLimitCounters();
		expect(rateLimitKeyCount()).toBe(0);
	});
});
