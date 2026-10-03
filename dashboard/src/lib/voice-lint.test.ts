// Self-check for the pure lint core. Run: DATABASE_URL=postgres://dummy@localhost:5/dummy bun test src/lib/voice-lint.test.ts
import { describe, expect, test } from "bun:test";
import { docSurface, lintAgainstPatterns, normalizePattern, patternApplies, type PatternRow } from "./voice-lint";

const pat = (over: Partial<PatternRow>): PatternRow => ({
	id: over.id ?? "p1",
	rule: over.rule ?? "rule",
	pattern: over.pattern ?? "",
	patternType: over.patternType ?? "literal",
	direction: over.direction ?? "avoid",
	beforeText: null,
	afterText: null,
});

describe("lintAgainstPatterns", () => {
	test("literal avoid match → violation with matched text", () => {
		const v = lintAgainstPatterns("Here's the thing: we should talk.", [pat({ pattern: "Here's the thing" })]);
		expect(v.length).toBe(1);
		expect(v[0].matched).toBe("Here's the thing");
	});
	test("case-insensitive", () => {
		expect(lintAgainstPatterns("LET THAT SINK IN.", [pat({ pattern: "let that sink in" })]).length).toBe(1);
	});
	test("clean text → no violations", () => {
		expect(lintAgainstPatterns("I emailed Eric the revised scope this morning.", [pat({ pattern: "let that sink in" })]).length).toBe(0);
	});
	test("regex pattern works", () => {
		const v = lintAgainstPatterns("The results were very good.", [pat({ pattern: "very \\w+", patternType: "regex" })]);
		expect(v.length).toBe(1);
		expect(v[0].matched).toBe("very good");
	});
	test("broken stored regex is skipped, not fatal", () => {
		expect(lintAgainstPatterns("any text", [pat({ pattern: "([unclosed", patternType: "regex" })]).length).toBe(0);
	});
	test("prefer match is not a violation", () => {
		expect(lintAgainstPatterns("I'm happy to make it work.", [pat({ pattern: "happy to", direction: "prefer" })]).length).toBe(0);
	});
});

describe("patternApplies (scope filtering)", () => {
	test("global pattern applies everywhere", () => {
		expect(patternApplies({ surface: null, genre: null }, { surface: "post", genre: "marketing" })).toBe(true);
		expect(patternApplies({ surface: null, genre: null }, { surface: "email" })).toBe(true);
	});
	test("surface-scoped pattern stays on its surface", () => {
		const p = { surface: "post", genre: null };
		expect(patternApplies(p, { surface: "post" })).toBe(true);
		expect(patternApplies(p, { surface: "email" })).toBe(false);
		expect(patternApplies(p, { surface: "newsletter" })).toBe(false);
	});
	test("genre must match when the pattern has one", () => {
		const p = { surface: "post", genre: "marketing" };
		expect(patternApplies(p, { surface: "post", genre: "marketing" })).toBe(true);
		expect(patternApplies(p, { surface: "post", genre: "casual" })).toBe(false);
		expect(patternApplies(p, { surface: "post" })).toBe(false); // doc has no genre
	});
	test("surface-global genre pattern applies to matching genre on any surface", () => {
		const p = { surface: null, genre: "marketing" };
		expect(patternApplies(p, { surface: "newsletter", genre: "marketing" })).toBe(true);
		expect(patternApplies(p, { surface: "newsletter", genre: "informational" })).toBe(false);
	});
	test("undefined scope = match all (back-compat)", () => {
		expect(patternApplies({ surface: "email", genre: null }, undefined)).toBe(true);
	});
});

describe("docSurface", () => {
	test("plain doc → docs, kinds map through", () => {
		expect(docSurface(null)).toBe("docs");
		expect(docSurface("post")).toBe("post");
		expect(docSurface("newsletter")).toBe("newsletter");
	});
});

describe("normalizePattern", () => {
	test("valid literal passes through", () => {
		const p = normalizePattern({ rule: "No throat-clearing", pattern: "Here's the thing" });
		expect(p?.patternType).toBe("literal");
		expect(p?.direction).toBe("avoid");
	});
	test("invalid regex rejected", () => {
		expect(normalizePattern({ rule: "r", pattern: "([unclosed", type: "regex" })).toBeNull();
	});
	test("empty rule/pattern rejected", () => {
		expect(normalizePattern({ rule: "", pattern: "x" })).toBeNull();
		expect(normalizePattern({ rule: "r", pattern: "  " })).toBeNull();
	});
	test("unknown type/direction fall back to defaults", () => {
		const p = normalizePattern({ rule: "r", pattern: "x", type: "yaml", direction: "maybe" });
		expect(p?.patternType).toBe("literal");
		expect(p?.direction).toBe("avoid");
	});
	test("oversized rule rejected", () => {
		expect(normalizePattern({ rule: "x".repeat(301), pattern: "x" })).toBeNull();
	});
});

describe("lint match ranges + lesson link", () => {
	test("literal violation carries index/length for underlining", () => {
		const v = lintAgainstPatterns("Glad you asked — Looking forward to it.", [
			{ id: "p1", rule: "no looking forward", pattern: "Looking forward to", patternType: "literal", direction: "avoid", beforeText: null, afterText: null, lessonText: "Sign off with a concrete next step instead." },
		]);
		expect(v.length).toBe(1);
		expect(v[0].matched).toBe("Looking forward to");
		expect(v[0].index).toBe("Glad you asked — ".length);
		expect(v[0].length).toBe("Looking forward to".length);
		expect(v[0].lesson).toBe("Sign off with a concrete next step instead.");
	});
	test("regex violation index points at the match", () => {
		const v = lintAgainstPatterns("hey, so can we start tomorrow", [
			{ id: "p2", rule: "no permission-seeking so", pattern: "( so |, so )(can|could) we", patternType: "regex", direction: "avoid", beforeText: null, afterText: null },
		]);
		expect(v.length).toBe(1);
		expect(v[0].index).toBe(3);
		expect(v[0].matched).toBe(", so can we");
		expect(v[0].lesson).toBeNull();
	});
});
