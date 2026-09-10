import { describe, expect, test } from "bun:test";
import { markdownToHtml, markdownToPostText, newsletterSubject } from "./publish";

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
	test("leading Subject: line wins over h1 and title", () => {
		const doc = {
			id: "x",
			title: "The Cactus Dispatch — Issue 01",
			markdown: "Subject: A tool that surfaces warm leads\n\n# Some heading\n\nbody",
		} as Parameters<typeof newsletterSubject>[0];
		expect(newsletterSubject(doc)).toBe("A tool that surfaces warm leads");
	});

	test("prefers first h1 heading over title", () => {
		const doc = {
			id: "x",
			title: "Draft 3",
			markdown: "# Teardown #7: 3 agents, 40 minutes\n\nbody",
		} as Parameters<typeof newsletterSubject>[0];
		expect(newsletterSubject(doc)).toBe("Teardown #7: 3 agents, 40 minutes");
	});

	test("falls back to title when no h1", () => {
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
