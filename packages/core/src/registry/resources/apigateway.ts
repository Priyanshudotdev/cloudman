import { z } from "zod";

import { defineResource } from "../types";

export const API_GATEWAY_METHODS = [
	"ANY",
	"GET",
	"POST",
	"PUT",
	"DELETE",
	"PATCH",
] as const;

export const apiGatewayConfigSchema = z.strictObject({
	stageName: z
		.string()
		.regex(/^[a-zA-Z0-9]+$/, "alphanumeric only")
		.default("v1"),
	routePath: z.string().min(1).max(255).default("{proxy+}"),
	httpMethod: z.enum(API_GATEWAY_METHODS).default("ANY"),
});

export type ApiGatewayConfig = z.infer<typeof apiGatewayConfigSchema>;

export const apiGatewayResource = defineResource(
	{
		type: "aws_apigateway",
		tofuKind: "aws_api_gateway_rest_api",
		label: "API Gateway",
		description: "Serverless REST endpoint for a Lambda",
		category: "serverless",
	},
	apiGatewayConfigSchema,
);