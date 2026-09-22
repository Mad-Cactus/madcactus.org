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

/**
 * The email subject for an issue: a leading `Subject:` markdown line (legacy
 * issues) wins, else the doc title. The title IS the subject — the editor
 * relabels it "Subject / title"; no separate subject storage, no H1 fallback.
 */
export function newsletterSubject(doc: Pick<Doc, "markdown" | "title">): string {
	const explicit = doc.markdown.match(/^Subject:\s*(.+)$/m)?.[1];
	return (explicit ?? doc.title).trim();
}

/** Strips the `Subject:` front-matter line so it never renders as body copy. */
function stripSubjectLine(md: string): string {
	return md.replace(/^Subject:.*$\n?/m, "");
}

/**
 * Email-only blocks: markdown between <!-- email-only --> and
 * <!-- /email-only --> renders in the sent email, never on the web archive
 * (and vice versa for <!-- web-only -->). One source doc, two channels.
 */
function stripChannelBlocks(html: string, channel: "email" | "web"): string {
	const drop = channel === "web" ? "email-only" : "web-only";
	return html.replace(
		new RegExp(`<!--\\s*${drop}\\s*-->[\\s\\S]*?<!--\\s*/${drop}\\s*-->`, "g"),
		"",
	);
}

/**
 * Gmail collapses <blockquote> as "quoted content" (the … trim), which hides
 * copy-paste prompts entirely. Email mode swaps blockquotes for a bordered,
 * inline-styled box that no client collapses. Web keeps real blockquotes.
 */
function quoteToPromptBox(html: string): string {
	return html.replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, (_, inner) => {
		const body = inner.trim().replace(/\n+/g, "<br>");
		return (
			`<div style="border:1px solid #b0a58a; border-left:4px solid #b0a58a; background:#f7f4ec;` +
			` padding:14px 16px; margin:16px 0; border-radius:6px; font-size:15px; line-height:1.6;">${body}</div>`
		);
	});
}

/**
 * Email-only boilerplate, appended to every send. Lives in code (not the doc)
 * so the web archive never shows "reply to this email" and the copy is edited
 * in one place across all issues. Per-issue email copy still goes in the doc
 * inside <!-- email-only --> markers. Client-safe: the admin email preview
 * renders exactly this so the preview matches what actually sends.
 */
export const EMAIL_FOOTER_HTML =
	`<hr style="border:none;border-top:1px solid #d8d2c4;margin:32px 0 20px;">` +
	`<p style="font-size:13px;color:#6b6455;line-height:1.6;">The Cactus Dispatch turns real AI deployments into ` +
	`patterns you can use this week. Questions, ideas, comments? Just reply to this email, I read and answer every one.</p>`;

/**
 * The email footer's cactus seal doubles as the open tracker: in sends its src
 * hits /api/track/open/<docId> (logged, then 302 to the static seal); the
 * ?r={{email}} variable is Resend's per-recipient substitution, so opens stay
 * per-person. Previews pass no docId and render the static seal untracked.
 * ponytail: origin hardcoded like shortLinkBase()'s fallback — both the brain
 * CTA and this pixel need the prod origin inside email HTML.
 */
export function emailFooterHtml(tracking?: { docId: string }): string {
	const sealSrc = tracking
		? `https://madcactus.org/api/track/open/${tracking.docId}?r={{email}}`
		: "https://madcactus.org/cactus-seal.png";
	return (
		EMAIL_FOOTER_HTML +
		`<img src="${sealSrc}" width="72" height="72" alt="Mad Cactus" style="display:block;margin:20px auto 0;border-radius:50%;" />`
	);
}

export function markdownToHtml(md: string, channel: "email" | "web" = "web"): string {
	let html = marked.parse(stripSubjectLine(md), { async: false }) as string;
	html = stripChannelBlocks(html, channel);
	if (channel === "email") html = quoteToPromptBox(html);
	return html;
}

/**
 * Default per-channel CTA for new issues — the ONE funnel. Seeded into the
 * appendix fields at creation; channel copy never lives in the body markdown.
 * Absolute URL: appendix renders in email too, where relative links break.
 */
export const BRAIN_CTA_APPENDIX =
	`Want one of these for your company? I build a custom company brain for a few businesses each month — free, so you can see what it actually does before you pay for anything. [Answer a few questions about your company and I'll build yours →](https://madcactus.org/brain)`;

/**
 * Email-only: /l/ links carry Resend's {{email}} variable so the /l/ redirect
 * log records WHO clicked (short_link_clicks). Web/social clicks stay
 * anonymous aggregate — identity doesn't exist there.
 */
function perPersonLinks(html: string): string {
	return html.replace(/href="([^"]*\/l\/[a-z0-9]+[^"]*)"/gi, (m, url: string) => {
		if (/r=/i.test(url)) return m;
		return `href="${url}${url.includes("?") ? "&" : "?"}r={{email}}"`;
	});
}

/**
 * Body + channel appendix, one render. The appendix (CTA block) renders AFTER
 * the body through the same pipeline, set off by a rule like the email footer.
 * Empty appendix (pre-appendix issues) renders exactly the body.
 */
export function renderIssueBody(md: string, appendix: string | null | undefined, channel: "email" | "web"): string {
	const body = markdownToHtml(md, channel);
	const a = (appendix ?? "").trim();
	const html = a
		? body +
			`<hr style="border:none;border-top:1px solid #d8d2c4;margin:32px 0 20px;">` +
			markdownToHtml(a, channel)
		: body;
	return channel === "email" ? perPersonLinks(html) : html;
}
