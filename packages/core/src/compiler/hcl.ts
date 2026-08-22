/**
 * Minimal HCL2 emission helpers.
 * Values here are primitives (string | number | boolean | flat maps),
 * which keeps escaping tractable without a full HCL parser.
 */

export function hclString(value: string): string {
	// JSON.stringify covers quotes/backslashes/control chars;
	// HCL additionally escapes interpolation with a doubled ${.
	return JSON.stringify(value).replace(/\$\{/g, "$${");
}

export function hclValue(value: unknown): string {
	if (typeof value === "string") return hclString(value);
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	throw new Error(`unsupported HCL scalar type: ${typeof value}`);
}

/** Depth-aware HCL writer producing consistently indented blocks. */
export class HclWriter {
	private readonly lines: string[] = [];
	private depth = 0;

	line(text = ""): this {
		this.lines.push(text.length > 0 ? `${"  ".repeat(this.depth)}${text}` : "");
		return this;
	}

	blank(): this {
		const last = this.lines[this.lines.length - 1];
		if (last !== "") this.lines.push("");
		return this;
	}

	block(header: string, body: () => void): this {
		this.line(`${header} {`);
		this.depth += 1;
		body();
		this.depth -= 1;
		this.line("}");
		return this;
	}

	toString(): string {
		return `${this.lines.join("\n").trimEnd()}\n`;
	}
}
