import { randomBytes, createHash, randomUUID } from "crypto";

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
