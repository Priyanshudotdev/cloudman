import { AwsConnection, encryptSecret } from "@my-better-t-app/db";
import { env } from "@my-better-t-app/env/server";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../lib/session";
import { requireAuth } from "../lib/session";

export const awsConnectionsRoute = new Hono<AppEnv>();

awsConnectionsRoute.use("*", requireAuth);

const ROLE_ARN_PATTERN = /^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_-]+$/;

const createConnectionSchema = z.object({
	label: z.string().min(1).max(80),
	roleArn: z
		.string()
		.regex(
			ROLE_ARN_PATTERN,
			"must be an IAM role ARN (arn:aws:iam::<account>:role/<name>)",
		),
	externalId: z.string().min(8).max(128),
	region: z.string().min(1).default("us-east-1"),
});

awsConnectionsRoute.get("/", async (c) => {
	const connections = await AwsConnection.find({ userId: c.get("userId") })
		.select("-externalId")
		.sort({ createdAt: -1 })
		.lean();
	return c.json({ connections });
});

awsConnectionsRoute.post("/", async (c) => {
	const parsed = createConnectionSchema.safeParse(await c.req.json());
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request", issues: parsed.error.issues },
			400,
		);
	}
	const connection = await AwsConnection.create({
		...parsed.data,
		externalId: env.CLOUDMAN_SECRET
			? encryptSecret(parsed.data.externalId, env.CLOUDMAN_SECRET)
			: parsed.data.externalId,
		userId: c.get("userId"),
	});
	const { externalId: _hidden, ...safe } = connection.toObject();
	return c.json({ connection: safe }, 201);
});

awsConnectionsRoute.delete("/:id", async (c) => {
	const id = c.req.param("id");
	if (!/^[a-f\d]{24}$/i.test(id)) return c.json({ error: "Not found" }, 404);
	const result = await AwsConnection.deleteOne({
		_id: id,
		userId: c.get("userId"),
	});
	if (result.deletedCount === 0) return c.json({ error: "Not found" }, 404);
	return c.json({ ok: true });
});
