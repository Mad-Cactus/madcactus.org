// Tests for the doc version layer — pure functions only, no DB.
// Run: DATABASE_URL=postgres://dummy@localhost:5/dummy bun test src/lib
import { describe, expect, test } from "bun:test";
import {
	pickPendingAgentVersion,
	shouldCoalesceVersion,
	unifiedDiff,
	wordDiff,
} from "./docs";

const mins = (n: number) => new Date(Date.now() - n * 60_000);

describe("shouldCoalesceVersion", () => {
	test("same author within window coalesces", () => {
		expect(
			shouldCoalesceVersion({ author: "human", createdAt: mins(2) }, "human"),
		).toBe(true);
	});
	test("outside window does not coalesce", () => {
		expect(
			shouldCoalesceVersion({ author: "human", createdAt: mins(11) }, "human"),
		).toBe(false);
	});
	test("author flip never coalesces (agent→human is a real handoff)", () => {
		expect(
			shouldCoalesceVersion({ author: "agent", createdAt: mins(1) }, "human"),
		).toBe(false);
		expect(
			shouldCoalesceVersion({ author: "human", createdAt: mins(1) }, "agent"),
		).toBe(false);
	});
	test("no history never coalesces", () => {
		expect(shouldCoalesceVersion(undefined, "human")).toBe(false);
	});
});

describe("pickPendingAgentVersion", () => {
	const d30 = mins(30);
	const d10 = mins(10);
	const d5 = mins(5);
	const v = (author: string, createdAt: Date) => ({ author, createdAt });
	test("agent version after last human version is pending", () => {
		const versions = [v("agent", d30), v("human", d10), v("agent", d5)];
		expect(pickPendingAgentVersion(versions)?.createdAt).toBe(d5);
	});
	test("human touched last → nothing pending", () => {
		const versions = [v("agent", d30), v("human", d5)];
		expect(pickPendingAgentVersion(versions)).toBeNull();
	});
	test("agent-only history → latest agent version pending", () => {
		const versions = [v("agent", d30), v("agent", d10)];
		expect(pickPendingAgentVersion(versions)?.createdAt).toBe(d10);
	});
	test("empty history → null", () => {
		expect(pickPendingAgentVersion([])).toBeNull();
	});
});

describe("diffing", () => {
	test("wordDiff marks additions and removals", () => {
		const parts = wordDiff("ship it fast", "ship it now");
		const removed = parts.find((p) => p.removed)?.value;
		const added = parts.find((p) => p.added)?.value;
		expect(removed).toBe("fast");
		expect(added).toBe("now");
	});
	test("unifiedDiff contains both sides as headers", () => {
		const d = unifiedDiff("hello world", "hello there");
		expect(d).toContain("-hello world");
		expect(d).toContain("+hello there");
	});
	test("identical content yields a diff with no +/- body lines", () => {
		const d = unifiedDiff("same", "same");
		expect(d).not.toContain("\n-same");
		expect(d).not.toContain("\n+same");
	});
});
