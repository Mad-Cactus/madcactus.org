// Self-check for short-link primitives. Run: bun test src/lib/short-links.test.ts
import { describe, expect, test } from "bun:test";
import { randomKey, shortLinkBase, SLUG_RE, TARGET_RE } from "./short-links";

describe("short-link primitives", () => {
	test("slug rules: lowercase alnum/dash, starts alnum, max 49", () => {
		expect(SLUG_RE.test("launch-2026")).toBe(true);
		expect(SLUG_RE.test("a")).toBe(true);
		expect(SLUG_RE.test("-lead")).toBe(false);
		expect(SLUG_RE.test("Has Spaces")).toBe(false);
		expect(SLUG_RE.test("a".repeat(50))).toBe(false);
	});

	test("target must be http(s) — blocks javascript: via redirect", () => {
		expect(TARGET_RE.test("https://madcactus.org/x?utm_source=li")).toBe(true);
		expect(TARGET_RE.test("javascript:alert(1)")).toBe(false);
		expect(TARGET_RE.test("ftp://x")).toBe(false);
	});

	test("randomKey: 7 chars, no lookalikes, unique across draws", () => {
		const keys = new Set(Array.from({ length: 200 }, () => randomKey()));
		expect(keys.size).toBeGreaterThan(190);
		for (const k of keys) {
			expect(k).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ]{7}$/);
		}
	});

	test("shortLinkBase: strips trailing slash from PUBLIC_SITE_URL", () => {
		process.env.PUBLIC_SITE_URL = "https://madcactus.org/";
		expect(shortLinkBase()).toBe("https://madcactus.org");
		delete process.env.PUBLIC_SITE_URL;
		expect(shortLinkBase()).toBe("https://madcactus.org");
	});
});
