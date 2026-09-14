// Short-link primitives shared by the admin API (/api/links) and brain-mcp tools.
// Pure — no db import — so both entries validate identically.

// slug doubles as a URL path segment — keep it boring. target is admin input
// but still must be an http(s) URL (no javascript: etc. via redirect).
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,48}$/;
export const TARGET_RE = /^https?:\/\//i;

// Dub-style opaque keys: 7 chars, nanoid custom-alphabet style, lookalikes
// (0 O 1 l I i o) dropped so a misread link never dead-ends. 54^7 ≈ 1.3e12.
const KEY_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
export function randomKey(len = 7): string {
	let out = "";
	for (let i = 0; i < len; i++) out += KEY_ALPHABET[Math.floor(Math.random() * KEY_ALPHABET.length)];
	return out;
}

/** Public origin /l/<slug> lives on (no trailing slash). */
export function shortLinkBase(): string {
	// ponytail: hardcoded fallback is the known prod origin; upgrade path = require the env
	return process.env.PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://madcactus.org";
}
