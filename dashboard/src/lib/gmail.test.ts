// Self-check for gmail payload parsing + mime building (pure functions).
// Run: DATABASE_URL=postgres://dummy bun test src/lib/gmail.test.ts
import { describe, expect, test } from "bun:test";
import { buildMime, extractText, addr } from "./gmail";

const part = (mimeType: string, data: string): any => ({
	mimeType,
	body: { data: Buffer.from(data).toString("base64") },
	headers: [],
});

const msg = (headers: [string, string][], parts?: any[], body?: any): any => ({
	headers: headers.map(([name, value]) => ({ name, value })),
	parts: parts ?? [],
	...(body ?? {}), // Gmail payload shape: { mimeType, body: { data } } at top level
});

describe("extractText", () => {
	test("prefers text/plain part", () => {
		const p = msg(
			[],
			[part("text/html", "<b>html</b>"), part("text/plain", "plain text")],
		);
		expect(extractText(p)).toBe("plain text");
	});

	test("walks nested multipart", () => {
		const p = msg([], [part("multipart/alternative", ""), part("text/plain", "nested")]);
		expect(extractText(p)).toBe("nested");
	});

	test("falls back to de-tagged html", () => {
		const p = msg([], [], part("text/html", "<p>Hello <b>world</b></p><p>Second &amp; last</p>"));
		const out = extractText(p);
		expect(out).toContain("Hello world");
		expect(out).toContain("Second & last");
		expect(out).not.toContain("<p>");
	});

	test("empty payload → empty string", () => {
		expect(extractText(msg([]))).toBe("");
	});
});

describe("addr", () => {
	test('"Name" <a@b.c>', () => {
		expect(addr('"Eric Brownell" <eric@cdl.example>')).toEqual({
			name: "Eric Brownell",
			email: "eric@cdl.example",
		});
	});
	test("bare address", () => {
		expect(addr("eric@cdl.example")).toEqual({ name: null, email: "eric@cdl.example" });
	});
});

describe("buildMime", () => {
	test("headers + body with CRLF", () => {
		const mime = buildMime({ to: "a@b.c", subject: "Hi", body: "line one\nline two" });
		expect(mime).toContain("To: a@b.c");
		expect(mime).toContain("Subject: Hi");
		expect(mime).toContain("text/plain");
		expect(mime).toContain("\r\n\r\nline one\nline two");
	});
});
