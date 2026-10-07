import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { csrfProtection } from "../lib/csrf";

// CORS_ORIGIN is http://localhost:3001 in the test env (see api.e2e setup);
// the middleware reads env.CORS_ORIGIN, which these tests exercise as-is.
const TRUSTED = "http://localhost:3001";

function buildApp() {
	const app = new Hono();
	app.use("/api/*", csrfProtection);
	app.post("/api/probe", (c) => c.json({ ok: true }));
	app.put("/api/probe", (c) => c.json({ ok: true }));
	app.get("/api/probe", (c) => c.json({ ok: true }));
	app.post("/api/auth/sign-in", (c) => c.json({ ok: true }));
	return app;
}

describe("csrfProtection", () => {
	test("allows safe methods regardless of origin", async () => {
		const app = buildApp();
		const res = await app.request("/api/probe", {
			headers: { origin: "https://evil.example" },
		});
		expect(res.status).toBe(200);
	});

	test("allows mutations with the trusted origin", async () => {
		const app = buildApp();
		const res = await app.request("/api/probe", {
			method: "POST",
			headers: { origin: TRUSTED },
		});
		expect(res.status).toBe(200);
	});

	test("allows mutations with no origin (curl, tests, server-to-server)", async () => {
		const app = buildApp();
		const res = await app.request("/api/probe", { method: "PUT" });
		expect(res.status).toBe(200);
	});

	test("rejects mutations from a foreign origin", async () => {
		const app = buildApp();
		for (const origin of [
			"https://evil.example",
			"https://localhost:3001.evil.example",
			`${TRUSTED}/.evil`,
			"http://localhost:3002",
		]) {
			const res = await app.request("/api/probe", {
				method: "POST",
				headers: { origin },
			});
			expect(res.status).toBe(403);
		}
	});

	test("rejects mutations with a foreign referer and no origin", async () => {
		const app = buildApp();
		const res = await app.request("/api/probe", {
			method: "POST",
			headers: { referer: "https://evil.example/some/form" },
		});
		expect(res.status).toBe(403);
	});

	test("skips better-auth endpoints", async () => {
		const app = buildApp();
		const res = await app.request("/api/auth/sign-in", {
			method: "POST",
			headers: { origin: "https://evil.example" },
		});
		expect(res.status).toBe(200);
	});
});
