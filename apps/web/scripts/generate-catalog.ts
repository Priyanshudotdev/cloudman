/**
 * Generates `src/lib/resource-catalog.generated.ts` from the
 * `@my-better-t-app/core` resource registry zod schemas.
 *
 * Run from apps/web: `bun run generate-catalog` (tsx).
 *
 * Notes:
 * - web does not depend on core as a package, so core is imported via a
 *   relative path. If core is ever added to web's dependencies, switch the
 *   CORE_IMPORT to the `@my-better-t-app/core` specifier.
 * - `RegisteredResource` does not carry its zod schema (see
 *   `defineResource` in core), so each config schema is imported by name and
 *   paired with its resource's `.type` in SCHEMAS below. New registry
 *   resources must be added here until core exposes schemas on the
 *   definition objects.
 * - String length checks are intentionally NOT mapped to min/max: the
 *   hand-written RESOURCE_SPECS only use min/max on number fields.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
	albConfigSchema,
	albResource,
	apiGatewayConfigSchema,
	apiGatewayResource,
	auroraConfigSchema,
	auroraResource,
	cloudwatchLogGroupConfigSchema,
	cloudwatchLogGroupResource,
	dynamoDbConfigSchema,
	dynamoDbResource,
	ebsConfigSchema,
	ebsResource,
	ec2ConfigSchema,
	ec2Resource,
	ecrConfigSchema,
	ecrResource,
	ecsConfigSchema,
	ecsResource,
	efsConfigSchema,
	efsResource,
	elasticacheConfigSchema,
	elasticacheResource,
	iamPolicyConfigSchema,
	iamPolicyResource,
	iamRoleConfigSchema,
	iamRoleResource,
	internetGatewayConfigSchema,
	internetGatewayResource,
	lambdaConfigSchema,
	lambdaResource,
	listResourceDefinitions,
	natGatewayConfigSchema,
	natGatewayResource,
	rdsConfigSchema,
	rdsResource,
	route53RecordConfigSchema,
	route53RecordResource,
	route53ZoneConfigSchema,
	route53ZoneResource,
	s3ConfigSchema,
	s3Resource,
	securityGroupConfigSchema,
	securityGroupResource,
	snsConfigSchema,
	snsResource,
	sqsConfigSchema,
	sqsResource,
	subnetConfigSchema,
	subnetResource,
	vpcConfigSchema,
	vpcResource,
} from "../../../packages/core/src/index";
import type { FieldDescriptor } from "../src/lib/resource-catalog";

type ZodField = z.ZodTypeAny;

interface WrapperDef {
	type?: string;
	innerType?: ZodField;
}

interface JsonProp {
	type?: string;
	enum?: unknown[];
	anyOf?: Array<{ const?: unknown }>;
	minimum?: number;
	maximum?: number;
	default?: unknown;
	items?: JsonProp;
	properties?: Record<string, JsonProp>;
	required?: string[];
}

const SCHEMAS: Record<string, ZodField> = {};
for (const [resource, schema] of [
	[albResource, albConfigSchema],
	[apiGatewayResource, apiGatewayConfigSchema],
	[auroraResource, auroraConfigSchema],
	[cloudwatchLogGroupResource, cloudwatchLogGroupConfigSchema],
	[dynamoDbResource, dynamoDbConfigSchema],
	[ebsResource, ebsConfigSchema],
	[ec2Resource, ec2ConfigSchema],
	[ecrResource, ecrConfigSchema],
	[ecsResource, ecsConfigSchema],
	[efsResource, efsConfigSchema],
	[elasticacheResource, elasticacheConfigSchema],
	[iamPolicyResource, iamPolicyConfigSchema],
	[iamRoleResource, iamRoleConfigSchema],
	[internetGatewayResource, internetGatewayConfigSchema],
	[lambdaResource, lambdaConfigSchema],
	[natGatewayResource, natGatewayConfigSchema],
	[rdsResource, rdsConfigSchema],
	[route53RecordResource, route53RecordConfigSchema],
	[route53ZoneResource, route53ZoneConfigSchema],
	[s3Resource, s3ConfigSchema],
	[securityGroupResource, securityGroupConfigSchema],
	[snsResource, snsConfigSchema],
	[sqsResource, sqsConfigSchema],
	[subnetResource, subnetConfigSchema],
	[vpcResource, vpcConfigSchema],
] as const) {
	SCHEMAS[resource.type] = schema as ZodField;
}

function humanize(key: string): string {
	const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Walks ZodOptional/ZodDefault wrappers to find effective optionality. */
function isOptionalField(field: ZodField): boolean {
	let node: ZodField | undefined = field;
	while (node) {
		const def: WrapperDef | undefined = (
			node as unknown as { _def?: WrapperDef }
		)._def;
		if (def?.type === "optional") return true;
		node = def?.innerType;
		if (def?.type !== "optional" && def?.type !== "default") break;
	}
	return false;
}

function describeProperty(
	key: string,
	prop: JsonProp,
	optional: boolean,
): FieldDescriptor {
	const label = humanize(key);
	const descriptor: FieldDescriptor = { key, label, type: "text" };

	const options = optionsOf(prop);
	if (options) {
		descriptor.type = "select";
		descriptor.options = options;
	} else if (prop.type === "integer" || prop.type === "number") {
		descriptor.type = "number";
		if (typeof prop.minimum === "number") descriptor.min = prop.minimum;
		if (typeof prop.maximum === "number") descriptor.max = prop.maximum;
	} else if (prop.type === "boolean") {
		descriptor.type = "boolean";
	} else if (prop.type === "array") {
		descriptor.type = "list";
		const items = prop.items;
		if (items?.type === "object" && items.properties) {
			const required = new Set(items.required ?? []);
			descriptor.itemFields = Object.entries(items.properties).map(
				([itemKey, itemProp]) =>
					describeProperty(itemKey, itemProp, !required.has(itemKey)),
			);
		} else if (items?.type === "integer" || items?.type === "number") {
			descriptor.itemType = "number";
		} else {
			descriptor.itemType = "text";
		}
	}

	if (optional) descriptor.optional = true;
	if (prop.default !== undefined) descriptor.default = prop.default;
	return descriptor;
}

/** enum → options; union-of-literals (anyOf const) → options. */
function optionsOf(prop: JsonProp): string[] | null {
	if (Array.isArray(prop.enum)) return prop.enum.map(String);
	if (
		Array.isArray(prop.anyOf) &&
		prop.anyOf.length > 0 &&
		prop.anyOf.every(
			(option) => option && typeof option === "object" && "const" in option,
		)
	) {
		return prop.anyOf.map((option) => String(option.const));
	}
	return null;
}

async function main(): Promise<void> {
	const generated: Record<string, FieldDescriptor[]> = {};
	for (const def of listResourceDefinitions()) {
		const schema = SCHEMAS[def.type];
		if (!schema) {
			console.warn(`[generate-catalog] no schema mapped for ${def.type}`);
			generated[def.type] = [];
			continue;
		}
		const shape = (schema as unknown as { shape?: Record<string, ZodField> })
			.shape;
		const fields: FieldDescriptor[] = [];
		for (const [key, field] of Object.entries(shape ?? {})) {
			const prop = z.toJSONSchema(field) as unknown as JsonProp;
			fields.push(describeProperty(key, prop, isOptionalField(field)));
		}
		generated[def.type] = fields;
		console.log(`[generate-catalog] ${def.type}: ${fields.length} fields`);
	}

	const output =
		"// AUTO-GENERATED by apps/web/scripts/generate-catalog.ts — DO NOT EDIT.\n" +
		"// Derived from the @my-better-t-app/core registry zod schemas.\n" +
		"// Refresh with: bun run generate-catalog (from apps/web).\n" +
		`import type { FieldDescriptor } from "./resource-catalog";\n` +
		"\n" +
		`export const GENERATED_FIELDS: Record<string, FieldDescriptor[]> = ${JSON.stringify(generated, null, "\t")};\n`;

	const outUrl = new URL(
		"../src/lib/resource-catalog.generated.ts",
		import.meta.url,
	);
	await mkdir(new URL("./", outUrl), { recursive: true });
	await writeFile(outUrl, output);
	console.log(
		`[generate-catalog] wrote ${Object.keys(generated).length} resource types`,
	);
}

void main();
