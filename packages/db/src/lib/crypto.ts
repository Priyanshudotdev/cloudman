import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

function key(secretHex: string): Buffer {
	return Buffer.from(secretHex, "hex");
}

/**
 * Encrypts an AWS connection secret with AES-256-GCM. Output is prefixed so
 * plaintext rows written before encryption existed can be detected and
 * transparently upgraded on first read.
 */
export function encryptSecret(plaintext: string, secretHex: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key(secretHex), iv);
	const encrypted = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const tag = cipher.getAuthTag();
	return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/** Returns null when the value is not ciphertext (legacy plaintext row). */
export function decryptSecret(value: string, secretHex: string): string | null {
	if (!value.startsWith(PREFIX)) return null;
	try {
		const parts = value.slice(PREFIX.length).split(":");
		const ivHex = parts[0] ?? "";
		const tagHex = parts[1] ?? "";
		const dataHex = parts[2] ?? "";
		const decipher = createDecipheriv(
			"aes-256-gcm",
			key(secretHex),
			Buffer.from(ivHex, "hex"),
		);
		decipher.setAuthTag(Buffer.from(tagHex, "hex"));
		return Buffer.concat([
			decipher.update(Buffer.from(dataHex ?? "", "hex")),
			decipher.final(),
		]).toString("utf8");
	} catch {
		throw new Error(
			"Failed to decrypt an AWS connection secret — is CLOUDMAN_SECRET the same key used to store it?",
		);
	}
}

/**
 * Decrypts when needed and re-encrypts legacy plaintext rows.
 * Returns the plaintext external id.
 */
export function resolveExternalId(value: string, secretHex?: string): string {
	if (!value.startsWith(PREFIX)) return value;
	if (!secretHex) {
		throw new Error(
			"CLOUDMAN_SECRET must be configured to read encrypted AWS connections.",
		);
	}
	return decryptSecret(value, secretHex) as string;
}
