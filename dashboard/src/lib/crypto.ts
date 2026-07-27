import { scryptSync, randomBytes, timingSafeEqual, createHash, randomUUID } from "crypto";

/** Hash password with scrypt. Returns "salt:hash" hex string. */
export function hashPassword(password: string): string {
	const salt = randomBytes(16).toString("hex");
	const hash = scryptSync(password, salt, 64).toString("hex");
	return `${salt}:${hash}`;
}

/** Verify password against stored "salt:hash" string. */
export function verifyPassword(password: string, stored: string): boolean {
	const colon = stored.indexOf(":");
	if (colon === -1) return false;
	const salt = stored.slice(0, colon);
	const hash = stored.slice(colon + 1);
	const hashBuf = Buffer.from(hash, "hex");
	const testBuf = scryptSync(password, salt, 64);
	if (hashBuf.length !== testBuf.length) return false;
	return timingSafeEqual(hashBuf, testBuf);
}

/** Generate a new API key: "mc_" + 32 hex chars. */
export function generateApiKey(): string {
	return `mc_${randomBytes(16).toString("hex")}`;
}

/** SHA-256 hash of a key for storage. */
export function hashKey(key: string): string {
	return createHash("sha256").update(key).digest("hex");
}

/** First 12 chars of key for display (e.g. "mc_a1b2c3d4..."). */
export function keyPrefix(key: string): string {
	return key.slice(0, 12) + "...";
}

export { randomUUID };
