export interface ParsedCidr {
	network: number;
	prefix: number;
}

/** Parses an IPv4 CIDR string; returns null when malformed or out of range. */
export function parseCidr(value: string): ParsedCidr | null {
	const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(
		value,
	);
	if (!match) return null;
	const parts = match.slice(1).map(Number);
	const prefix = parts[4] ?? -1;
	if (parts.some((p) => p === undefined || p < 0 || p > 255)) return null;
	if (prefix < 0 || prefix > 32) return null;
	const ip =
		(((parts[0] ?? 0) << 24) |
			((parts[1] ?? 0) << 16) |
			((parts[2] ?? 0) << 8) |
			(parts[3] ?? 0)) >>>
		0;
	return { network: (ip & maskFor(prefix)) >>> 0, prefix };
}

function maskFor(prefix: number): number {
	return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/**
 * True when `child` is a subnet (or equal) of `parent`:
 * same address family semantics — child prefix must be >= parent prefix and
 * its masked network must fall inside the parent block.
 */
export function cidrContains(parent: string, child: string): boolean {
	const p = parseCidr(parent);
	const c = parseCidr(child);
	if (!p || !c) return false;
	if (c.prefix < p.prefix) return false;
	// parseCidr already normalizes host bits, so compare networks directly.
	return (c.network & maskFor(p.prefix)) >>> 0 === p.network;
}

export function isValidIpv4Cidr(value: string): boolean {
	return parseCidr(value) !== null;
}
