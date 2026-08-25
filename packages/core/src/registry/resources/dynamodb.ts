import { z } from "zod";

import { defineResource } from "../types";

export const DYNAMODB_KEY_TYPES = ["S", "N", "B"] as const;
export const DYNAMODB_BILLING_MODES = [
	"PAY_PER_REQUEST",
	"PROVISIONED",
] as const;

export const dynamoDbConfigSchema = z.strictObject({
	hashKey: z
		.string()
		.regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be an attribute name")
		.default("id"),
	hashKeyType: z.enum(DYNAMODB_KEY_TYPES).default("S"),
	rangeKey: z
		.string()
		.regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be an attribute name")
		.optional(),
	rangeKeyType: z.enum(DYNAMODB_KEY_TYPES).default("S"),
	billingMode: z.enum(DYNAMODB_BILLING_MODES).default("PAY_PER_REQUEST"),
});

export type DynamoDbConfig = z.infer<typeof dynamoDbConfigSchema>;

export const dynamoDbResource = defineResource(
	{
		type: "aws_dynamodb_table",
		tofuKind: "aws_dynamodb_table",
		label: "DynamoDB Table",
		description: "Serverless NoSQL key-value store",
		category: "database",
	},
	dynamoDbConfigSchema,
);
