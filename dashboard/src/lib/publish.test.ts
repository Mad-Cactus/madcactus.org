import { describe, expect, test } from "bun:test";
import { markdownToHtml, markdownToPostText, newsletterSubject, publishDoc, renderIssueBody, renderIssueEmail, EMAIL_FOOTER_HTML } from "./publish";

describe("publishDoc newsletter channel", () => {
	const base = {
		id: "x",
		kind: "newsletter",
		title: "Issue 9",
		markdown: "hello",
	} as Parameters<typeof publishDoc>[0];

	test("web-only skips the Resend broadcast (no env, no network)", async () => {
		// RESEND_API_KEY is unset here — an email attempt would throw before network
		delete process.env.RESEND_API_KEY;
		await expect(publishDoc({ ...base, publishChannel: "web" })).resolves.toBe("web");
	});

	test("already-published newsletter never re-emails — web updates only", async () => {
		delete process.env.RESEND_API_KEY;
		await expect(publishDoc({ ...base, publishedAt: new Date() })).resolves.toBe("sent");
		// a failed send (publishedAt null) still tries — and throws without creds
		await expect(publishDoc(base)).rejects.toThrow("RESEND_API_KEY not configured");
	});
});

// markdownToPostText must produce plain text that reads like a human wrote it
describe("markdownToPostText", () => {
	test("strips headings, bold, italics, code", () => {
		const md = "## The tension\n\nThis is **important** and *subtle* with `code`.";
		expect(markdownToPostText(md)).toBe("The tension\n\nThis is important and subtle with code.");
	});

	test("converts links to text (url)", () => {
		expect(markdownToPostText("Read the [blueprint](https://example.com) here")).toBe(
			"Read the blueprint (https://example.com) here",
		);
	});

	test("drops images and collapses whitespace runs", () => {
		const md = "line one\n\n\n\n![alt](https://x.com/i.png)\n\n\n\nline two";
		expect(markdownToPostText(md)).toBe("line one\n\nline two");
	});

	test("list items become bullets, blockquotes unquoted", () => {
		const md = "- one\n- two\n\n> quoted wisdom";
		expect(markdownToPostText(md)).toBe("• one\n• two\n\nquoted wisdom");
	});

	test("code fences keep content, lose fences", () => {
		const md = "```\nconst x = 1;\n```";
		expect(markdownToPostText(md)).toBe("const x = 1;");
	});
});

describe("newsletterSubject", () => {
	test("leading Subject: line wins — legacy issues keep their stored subject", () => {
		const doc = {
			id: "x",
			title: "The Cactus Dispatch — Issue 01",
			markdown: "Subject: A tool that surfaces warm leads\n\n# Some heading\n\nbody",
		} as Parameters<typeof newsletterSubject>[0];
		expect(newsletterSubject(doc)).toBe("A tool that surfaces warm leads");
	});

	test("title is the subject — the H1 fallback is gone", () => {
		const doc = {
			id: "x",
			title: "Teardown #7: 3 agents, 40 minutes",
			markdown: "# Some old heading\n\nbody",
		} as Parameters<typeof newsletterSubject>[0];
		expect(newsletterSubject(doc)).toBe("Teardown #7: 3 agents, 40 minutes");
	});

	test("falls back to title when no Subject: line", () => {
		const doc = { id: "x", title: "Issue 8", markdown: "no heading here" } as Parameters<
			typeof newsletterSubject
		>[0];
		expect(newsletterSubject(doc)).toBe("Issue 8");
	});
});

describe("markdownToHtml channels", () => {
	const md = [
		"Subject: The hook",
		"",
		"Body intro.",
		"",
		"<!-- email-only -->",
		"**P.S.** Reply to this email.",
		"<!-- /email-only -->",
		"",
		"> paste this prompt",
	].join("\n");

	test("subject line never renders as body copy", () => {
		for (const channel of ["web", "email"] as const) {
			expect(markdownToHtml(md, channel)).not.toContain("Subject:");
		}
	});

	test("web drops email-only blocks, email keeps them", () => {
		expect(markdownToHtml(md, "web")).not.toContain("Reply to this email");
		expect(markdownToHtml(md, "email")).toContain("Reply to this email");
	});

	test("email swaps blockquote for a collapsible-proof div, web keeps blockquote", () => {
		const email = markdownToHtml(md, "email");
		expect(email).not.toContain("<blockquote>");
		expect(email).toContain("paste this prompt");
		expect(markdownToHtml(md, "web")).toContain("<blockquote>");
	});
});

describe("renderIssueBody (body → appendix)", () => {
	test("empty appendix renders exactly the body (pre-appendix issues)", () => {
		const html = renderIssueBody("hello", "", "email");
		expect(html).toContain("hello");
		expect(html).not.toContain("CTA");
	});

	test("appendix renders after the body, through the same pipeline", () => {
		const html = renderIssueBody("Body first.", "**CTA block**", "web");
		const body = html.indexOf("Body first.");
		const cta = html.indexOf("<strong>CTA block</strong>");
		expect(body).toBeGreaterThan(-1);
		expect(cta).toBeGreaterThan(body);
	});

	test("email appendix renders between body and the code-owned footer", () => {
		const html = renderIssueBody("Body.", "CTA block", "email") + EMAIL_FOOTER_HTML;
		const body = html.indexOf("Body.");
		const cta = html.indexOf("CTA block");
		const footer = html.indexOf("reply to this email");
		expect(body).toBeLessThan(cta);
		expect(cta).toBeLessThan(footer);
	});

	test("web appendix drops email-only blocks in channel copy too", () => {
		const html = renderIssueBody("body", "<!-- email-only -->reply<!-- /email-only -->", "web");
		expect(html).not.toContain("reply");
	});

	test("email /l/ links carry the per-person r variable, web links don't", () => {
		const md = "[blueprint](https://madcactus.org/l/abc1234)";
		expect(renderIssueBody(md, "", "email")).toContain('href="https://madcactus.org/l/abc1234?r={{email}}"');
		expect(renderIssueBody(md, "", "web")).not.toContain("r=");
	});

	test("r is appended, not duplicated, on /l/ links that already have a query", () => {
		const md = "[x](https://madcactus.org/l/abc1234?utm_source=n)";
		expect(renderIssueBody(md, "", "email")).toContain('href="https://madcactus.org/l/abc1234?utm_source=n&r={{email}}"');
	});
});

describe("renderIssueEmail (the Dispatch template)", () => {
	const full = renderIssueEmail({
		subject: "Teardown #7",
		markdown: "## The tension\n\nBody copy here.",
		appendix: "[Build yours →](https://madcactus.org/l/abc1234?r={{email}})",
		issueNumber: 7,
		tracking: { docId: "d1" },
	});

	test("web-view chrome: vellum bg, gold eyebrow with issue number, serif title", () => {
		expect(full).toContain("background:#f6f6f6");
		expect(full).toContain("THE CACTUS DISPATCH · ISSUE 07");
		expect(full).toContain("#bc9c5c");
		expect(full).toContain("<h1 style=\"font-family:Georgia");
		expect(full).toContain("Teardown #7</h1>");
	});

	test("body tags carry inline styles (email clients strip <style>)", () => {
		expect(full).toContain("<h2 style=");
		expect(full).toContain("<p style=");
	});

	test("footer seal is the tracked pixel when tracking, static otherwise", () => {
		expect(full).toContain("/api/track/open/d1?r={{email}}");
		const plain = renderIssueEmail({ subject: "S", markdown: "b" });
		expect(plain).toContain('src="https://madcactus.org/cactus-seal.png"');
		expect(plain).not.toContain("/api/track/open");
	});

	test("appendix /l/ link keeps the per-person r variable", () => {
		expect(full).toContain("r={{email}}");
	});
});
