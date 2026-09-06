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

// ── Rate-limit backoff (fetch stubbed; token endpoint answers too) ──
import { gmail } from "./gmail";

const account = { id: "a1", refreshToken: "r" } as any;
const json = (body: any, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const QUOTA_403 = () =>
	json(
		{ error: { code: 403, message: "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user'" } },
		403,
	);

// stub fetch: token endpoint always OK; gmail endpoint replays `api` responses,
// then 200s with `final()`. api/final are factories — Response bodies are single-use.
function stubFetch(api: Response[], final: () => Response) {
	const paths: string[] = [];
	const real = globalThis.fetch;
	globalThis.fetch = (async (url: any) => {
		if (String(url).includes("gmail.googleapis.com")) {
			paths.push(String(url).replace(/^.*gmail\/v1\/users\/me/, ""));
			return api.length ? api.shift()! : final();
		}
		return json({ access_token: "at", expires_in: 3600 });
	}) as any;
	return { paths, restore: () => (globalThis.fetch = real) };
}

describe("gmail backoff", () => {
	test("quota 403 → retries → succeeds", async () => {
		const { paths, restore } = stubFetch([QUOTA_403()], () => json({ id: "t1", historyId: "1" }));
		try {
			const out = await gmail<{ id: string }>(account, "/threads/x", { method: "POST" });
			expect(out.id).toBe("t1");
			expect(paths).toEqual(["/threads/x", "/threads/x"]);
		} finally {
			restore();
		}
	});

	test("plain 403 (permission) → fails fast, no retry", async () => {
		const { paths, restore } = stubFetch([json({ error: { code: 403, message: "The user is not authorized" } }, 403)], () => json({}));
		try {
			await expect(gmail(account, "/threads/x")).rejects.toThrow(/403|not authorized/);
			expect(paths).toEqual(["/threads/x"]);
		} finally {
			restore();
		}
	});

	test("GET 5xx → retries; POST 5xx → fails fast", async () => {
		const get = stubFetch([json({ error: { code: 500 } }, 500)], () => json({ id: "g1" }));
		try {
			const out = await gmail<{ id: string }>(account, "/threads/x");
			expect(out.id).toBe("g1");
			expect(get.paths.length).toBe(2);
		} finally {
			get.restore();
		}
		const post = stubFetch([json({ error: { code: 500 } }, 500)], () => json({}));
		try {
			await expect(gmail(account, "/messages/send", { method: "POST" })).rejects.toThrow();
			expect(post.paths.length).toBe(1);
		} finally {
			post.restore();
		}
	});

	test(
		"gives up after 3 retries on persistent throttling",
		async () => {
			const { paths, restore } = stubFetch([], QUOTA_403);
			try {
				await expect(gmail(account, "/threads/x")).rejects.toThrow(/Quota/);
				expect(paths.length).toBe(4); // 1 + 3 retries
			} finally {
				restore();
			}
		},
		15_000, // backoff sleeps 1+2+4s + jitter
	);
});
