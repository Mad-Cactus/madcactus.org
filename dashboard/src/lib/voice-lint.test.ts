// Self-check for the pure lint core. Run: DATABASE_URL=postgres://dummy@localhost:5/dummy bun test src/lib/voice-lint.test.ts
import { describe, expect, test } from "bun:test";
import { lintAgainstPatterns, type PatternRow } from "./voice-lint";

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
