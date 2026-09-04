import { describe, expect, test } from "bun:test";
import { extractMemoryBody, isStale, parseJudgement } from "./memory";

// extraction semantics ported from macro-inc/macro crates/memory tests
describe("extractMemoryBody", () => {
	test("strips surrounding narration", () => {
		const content = "I have enough context. Let me write the memory.\n<memory>\nMad Cactus is a consulting firm.\n</memory>\nDone!";
		expect(extractMemoryBody(content)).toBe("Mad Cactus is a consulting firm.");
	});

	test("rejects missing tags", () => {
		expect(extractMemoryBody("Mad Cactus is a consulting firm.")).toBeNull();
		expect(extractMemoryBody("<memory>unterminated")).toBeNull();
		expect(extractMemoryBody("</memory>backwards<memory>")).toBeNull();
	});

	test("uses last closing tag", () => {
		expect(extractMemoryBody("<memory>uses </memory> in prose</memory>")).toBe(
			"uses </memory> in prose",
		);
	});

	test("rejects empty body", () => {
		expect(extractMemoryBody("<memory></memory>")).toBeNull();
	});
});

describe("isStale", () => {
	test("fresh memory not stale", () => {
		expect(isStale(new Date(Date.now() - 60 * 60 * 1000))).toBe(false);
	});

	test("memory older than 24h is stale", () => {
		expect(isStale(new Date(Date.now() - 25 * 60 * 60 * 1000))).toBe(true);
	});
});

describe("parseJudgement", () => {
	test("parses plain JSON", () => {
		expect(parseJudgement('{"accepted": true, "reason": "rich data"}')).toEqual({
			accepted: true,
			reason: "rich data",
		});
	});

	test("parses JSON inside code fences", () => {
		expect(parseJudgement('```json\n{"accepted": false, "reason": "too thin"}\n```')).toEqual({
			accepted: false,
			reason: "too thin",
		});
	});

	test("throws on no JSON", () => {
		expect(() => parseJudgement("no json here")).toThrow();
	});

	test("throws on malformed fields", () => {
		expect(() => parseJudgement('{"ok": true}')).toThrow();
	});
});
