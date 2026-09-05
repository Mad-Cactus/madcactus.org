// Self-check for gmail payload parsing + mime building (pure functions).
// Run: DATABASE_URL=postgres://dummy bun test src/lib/gmail.test.ts
import { describe, expect, test } from "bun:test";
import { buildMime, extractText, addr, latestMessage, isTrashed } from "./gmail";

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

describe("latestMessage", () => {
	const m = (id: string, internalDate: string, labelIds: string[] = []): any => ({
		id,
		internalDate,
		labelIds,
	});

	test("picks last by date, not array order (sent mail stored after a newer reply)", () => {
		const msgs = [m("reply", "1700001000000"), m("mine", "1700009000000")];
		expect(latestMessage(msgs)?.id).toBe("mine");
	});

	test("empty array → undefined", () => {
		expect(latestMessage([])).toBeUndefined();
	});
});

describe("isTrashed", () => {
	test("every message TRASH → true", () => {
		expect(isTrashed({ messages: [{ labelIds: ["TRASH"] }, { labelIds: ["TRASH", "UNREAD"] }] as any })).toBe(true);
	});
	test("any message still live → false", () => {
		expect(isTrashed({ messages: [{ labelIds: ["INBOX"] }, { labelIds: ["TRASH"] }] as any })).toBe(false);
	});
	test("no messages → false", () => {
		expect(isTrashed({})).toBe(false);
	});
});
