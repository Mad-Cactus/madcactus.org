// Crypto + encoding helpers on Bun/web primitives — no node:crypto.
// Web-standard globals: crypto.getRandomValues, crypto.randomUUID, btoa/atob,
// TextEncoder/TextDecoder. Hashing: Bun.CryptoHasher.

/** n random bytes as hex (API keys, share tokens, OAuth state). */
export function randomHex(nBytes: number): string {
	return [...crypto.getRandomValues(new Uint8Array(nBytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generate a new API key: "mc_" + 32 hex chars. */
export function generateApiKey(): string {
	return `mc_${randomHex(16)}`;
}

/** SHA-256 hash of a key for storage. */
export function hashKey(key: string): string {
	return new Bun.CryptoHasher("sha256").update(key).digest("hex");
}

/** UTF-8 safe base64. */
export function toBase64(data: string | Uint8Array): string {
	const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
	let bin = "";
	const chunk = 0x8000; // stay under String.fromCharCode arg limits
	for (let i = 0; i < bytes.length; i += chunk) {
		bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(bin);
}

/** UTF-8 safe base64url (RFC 4648 §5) — Gmail's raw message encoding. */
export function toBase64Url(data: string | Uint8Array): string {
	return toBase64(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode base64/base64url to a UTF-8 string (Gmail payloads). */
export function fromBase64(b64: string): string {
	const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
	const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

/** First 12 chars of key for display (e.g. "mc_a1b2c3d4..."). */
export function keyPrefix(key: string): string {
	return key.slice(0, 12) + "...";
}
