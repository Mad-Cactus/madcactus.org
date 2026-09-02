// Self-check for the redline engine's pure logic (diff + lint + gate).
// Run: bun test src/lib/redline.test.ts
import { describe, expect, test } from "bun:test";
import { lintContent, shouldBlock, unifiedDiff, wordDiff } from "./redline";
import type { RedlinePattern } from "../db/schema";

const pat = (p: Partial<RedlinePattern>): RedlinePattern => ({
	id: "p1",
	lessonId: null,
	rule: "rule",
	pattern: "",
	patternType: "literal",
	direction: "avoid",
	category: "style",
	beforeText: null,
	afterText: null,
	confidence: "unconfirmed",
	createdAt: new Date(),
	...p,
});

describe("unifiedDiff", () => {
	test("shows changed line", () => {
		const d = unifiedDiff("hello world\n", "hello there\n");
		expect(d).toContain("-hello world");
		expect(d).toContain("+hello there");
	});
	test("identical content → empty patch body", () => {
		const d = unifiedDiff("same\n", "same\n");
		expect(d).not.toContain("+same");
	});
});

describe("wordDiff", () => {
	test("flags removed and added words", () => {
		const parts = wordDiff("em dash — bad", "em dash gone");
		expect(parts.some((p) => p.removed && p.value.includes("—"))).toBe(true);
		expect(parts.some((p) => p.added && p.value.includes("gone"))).toBe(true);
	});
});

describe("lintContent", () => {
	test("avoid literal match blocks with line + context", () => {
		const v = lintContent("line one\nand then — more", [
			pat({ pattern: "—", direction: "avoid" }),
		]);
		expect(v.length).toBe(1);
		expect(v[0].direction).toBe("avoid");
		expect(v[0].line).toBe(2);
		expect(shouldBlock(v)).toBe(true);
	});

	test("literal match is case-insensitive", () => {
		const v = lintContent("Please Find Attached", [
			pat({ pattern: "please find attached", direction: "avoid" }),
		]);
		expect(v.length).toBe(1);
	});

	test("prefer pattern absent → suggestion, does not block", () => {
		const v = lintContent("nothing else to add", [
			pat({ pattern: "cta", direction: "prefer", rule: "always include CTA" }),
		]);
		expect(v.length).toBe(1);
		expect(v[0].direction).toBe("prefer");
		expect(shouldBlock(v)).toBe(false);
	});

	test("prefer pattern present → no violation", () => {
		const v = lintContent("click the cta below", [
			pat({ pattern: "cta", direction: "prefer" }),
		]);
		expect(v.length).toBe(0);
	});

	test("regex pattern works", () => {
		const v = lintContent("hi", [pat({ pattern: "^.{1,3}$", patternType: "regex", direction: "avoid" })]);
		expect(v.length).toBe(1);
	});

	test("invalid regex skipped, not thrown", () => {
		const v = lintContent("any", [pat({ pattern: "([", patternType: "regex" })]);
		expect(v.length).toBe(0);
	});

	test("multiple avoid hits → multiple violations", () => {
		const v = lintContent("— a — b", [pat({ pattern: "—" })]);
		expect(v.length).toBe(2);
	});
});
