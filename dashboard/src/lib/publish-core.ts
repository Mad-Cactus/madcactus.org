// Pure markdown→destination transforms — shared by the publish dispatcher
// (server) and the dashboard previews (client). Keep this file import-safe
// for the browser: no node builtins, no Resend/LinkedIn SDKs.
import { marked } from "marked";
import type { Doc } from "~/db/schema";

/** Markdown → plain text that reads well as a LinkedIn post. */
export function markdownToPostText(md: string): string {
	return md
		.replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, "").trim())
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
		.replace(/(\*\*|__)(.*?)\1/g, "$2")
		.replace(/(\*|_)(.*?)\1/g, "$2")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/^>\s?/gm, "")
		.replace(/^[-*+]\s+/gm, "• ")
		.replace(/^\|.*\|$/gm, (l) => l.replace(/\|/g, " ").trim())
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function newsletterSubject(doc: Pick<Doc, "markdown" | "title">): string {
	const heading = doc.markdown.match(/^#\s+(.+)$/m)?.[1];
	return (heading ?? doc.title).trim();
}

export function markdownToHtml(md: string): string {
	// links open in the email client's browser; marked handles the rest
	return marked.parse(md, { async: false }) as string;
}
