// applyTextHunks must produce text-identical results while keeping Loro ops
// proportional to the actual change (history = real edits, not clobbers).
import { describe, expect, test } from "bun:test";
import { LoroDoc } from "loro-crdt";
import { applyTextHunks } from "./crdt-text";

describe("applyTextHunks", () => {
	test("no-op when identical", () => {
		const doc = new LoroDoc();
		const t = doc.getText("markdown");
		t.insert(0, "hello world");
		expect(applyTextHunks(t, "hello world")).toBe(false);
		expect(t.toString()).toBe("hello world");
	});

	test("insert in middle keeps surrounding text", () => {
		const doc = new LoroDoc();
		const t = doc.getText("markdown");
		t.insert(0, "hello world");
		expect(applyTextHunks(t, "hello brave world")).toBe(true);
		expect(t.toString()).toBe("hello brave world");
	});

	test("delete hunk", () => {
		const doc = new LoroDoc();
		const t = doc.getText("markdown");
		t.insert(0, "one two three");
		expect(applyTextHunks(t, "one three")).toBe(true);
		expect(t.toString()).toBe("one three");
	});

	test("one-word rewrite exports as small update, not full replace", () => {
		const doc = new LoroDoc();
		const t = doc.getText("markdown");
		const para = "The quick brown fox jumps over the lazy dog. ".repeat(20);
		t.insert(0, para);
		doc.commit();
		const before = doc.oplogVersion();
		applyTextHunks(t, para.replace("lazy", "sleepy"));
		doc.commit();
		const updates = doc.export({ mode: "update", from: before });
		// a full delete+insert would export ≥ 2×para bytes; a word hunk is tiny
		expect(updates.byteLength).toBeLessThan(para.length / 2);
		expect(t.toString()).toBe(para.replace("lazy", "sleepy"));
	});

	test("empty → content → empty round trip", () => {
		const doc = new LoroDoc();
		const t = doc.getText("markdown");
		expect(applyTextHunks(t, "draft text\n")).toBe(true);
		expect(t.toString()).toBe("draft text\n");
		expect(applyTextHunks(t, "")).toBe(true);
		expect(t.toString()).toBe("");
	});
});
