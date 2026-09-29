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

// ── Email template — the Dispatch issue page (vellum, serif, gold accents)
// rendered with inline styles only, because email clients strip <style>.
// Shared byte-for-byte by the Resend broadcast and the dashboard preview.

const E = {
	gold: "#bc9c5c",
	ink: "#000",
	vellum: "#f6f6f6",
	serif: "Georgia,'Times New Roman',serif",
	sans: "Arial,Helvetica,sans-serif",
};

/** Inline styles onto the plain tags marked emits. */
function inlineBodyStyles(html: string): string {
	return html
		.replace(/<h2>/g, `<h2 style="font-family:${E.sans};font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${E.ink};margin:40px 0 14px;">`)
		.replace(/<h3>/g, `<h3 style="font-family:${E.sans};font-size:14px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${E.ink};margin:32px 0 12px;">`)
		.replace(/<p>/g, `<p style="font-family:${E.serif};font-size:16px;line-height:1.6;color:${E.ink};margin:0 0 18px;">`)
		.replace(/<ul>/g, `<ul style="font-family:${E.serif};font-size:16px;line-height:1.6;color:${E.ink};margin:0 0 18px;padding-left:22px;">`)
		.replace(/<ol>/g, `<ol style="font-family:${E.serif};font-size:16px;line-height:1.6;color:${E.ink};margin:0 0 18px;padding-left:22px;">`)
		.replace(/<li>/g, `<li style="margin-bottom:8px;">`)
		.replace(/<a href/g, `<a style="color:${E.ink};border-bottom:1px solid ${E.gold};text-decoration:none;" href`)
		.replace(/<hr>/g, `<hr style="border:none;border-top:1px solid #d8d2c4;margin:32px 0;">`)
		.replace(/<code>/g, `<code style="background:#f1ede2;padding:1px 4px;border-radius:3px;font-size:14px;">`)
		.replace(/<pre>/g, `<pre style="background:#f1ede2;padding:12px;overflow-x:auto;font-size:13px;line-height:1.5;">`);
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The full email document for an issue: same design as the web Dispatch page
 * (eyebrow → serif title → body → CTA appendix → footer + seal). `tracking`
 * swaps the seal for the tracked pixel in real sends; previews render the
 * static one. Everything inline-styled — no <style>, no webfonts (Playfair
 * falls back to Georgia).
 */
export function renderIssueEmail(opts: {
	subject: string;
	markdown: string;
	appendix?: string | null;
	issueNumber?: number | null;
	tracking?: { docId: string };
}): string {
	const eyebrow = `THE CACTUS DISPATCH${opts.issueNumber ? ` · ISSUE ${String(opts.issueNumber).padStart(2, "0")}` : ""}`;
	const bodyHtml = inlineBodyStyles(renderIssueBody(opts.markdown, opts.appendix, "email"));
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
		`<body style="margin:0;background:${E.vellum};">` +
		`<div style="max-width:640px;margin:0 auto;padding:36px 24px 28px;">` +
		`<p style="font-family:${E.sans};font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${E.gold};margin:0 0 28px;">${eyebrow}</p>` +
		`<h1 style="font-family:${E.serif};font-weight:400;font-size:32px;line-height:1.15;color:${E.ink};margin:0 0 28px;">${escapeHtml(opts.subject)}</h1>` +
		bodyHtml +
		emailFooterHtml(opts.tracking) +
		`</div></body></html>`;
}

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
 * appendix fields at creation with the issue's own /l/ link, so CTA clicks are
 * tracked per person in email (r={{email}}) and per issue everywhere, and the
 * target carries ref=<docId> for brain-request attribution. Absolute URL: the
 * appendix renders in email too, where relative links break.
 */
export function brainCtaAppendix(link: string): string {
	return `P.S. Want to start turning your company AI-native? I build a custom company brain for one reader every week, completely free. All you have to do is click below. [**{ GET YOUR COMPANY BRAIN }**](${link})`;
}

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
