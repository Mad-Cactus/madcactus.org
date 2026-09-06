// Publish dispatch: a doc of kind "post" goes to LinkedIn, "newsletter" goes
// out as a Resend broadcast to the Cactus Dispatch audience. Failures email
// the owner — a scheduled publish must never die silently.
import { marked } from "marked";
import { Resend } from "resend";
import type { Doc } from "~/db/schema";
import { postToLinkedIn } from "~/lib/social";

const ALERT_EMAIL = process.env.ALERT_EMAIL ?? "cpfeifer@madcactus.org";
const NEWSLETTER_FROM = process.env.NEWSLETTER_FROM ?? "Collin Pfeifer <dispatch@madcactus.org>";

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

export function newsletterSubject(doc: Doc): string {
	const heading = doc.markdown.match(/^#\s+(.+)$/m)?.[1];
	return (heading ?? doc.title).trim();
}

export function markdownToHtml(md: string): string {
	// links open in the email client's browser; marked handles the rest
	return marked.parse(md, { async: false }) as string;
}

export async function publishDoc(doc: Doc): Promise<string> {
	if (doc.kind === "post") return postToLinkedIn(markdownToPostText(doc.markdown));
	if (doc.kind === "newsletter") return sendNewsletter(doc);
	throw new Error(`doc ${doc.id} has no publishable kind`);
}

async function sendNewsletter(doc: Doc): Promise<string> {
	const key = process.env.RESEND_API_KEY;
	const segmentId = process.env.RESEND_SEGMENT_ID;
	if (!key) throw new Error("RESEND_API_KEY not configured");
	if (!segmentId) throw new Error("RESEND_SEGMENT_ID not configured");
	const resend = new Resend(key);
	const { data, error } = await resend.broadcasts.create({
		name: doc.title,
		segmentId,
		from: NEWSLETTER_FROM,
		subject: newsletterSubject(doc),
		html: markdownToHtml(doc.markdown),
	});
	if (error) throw new Error(`resend broadcast create failed: ${error.message}`);
	const sent = await resend.broadcasts.send(data.id);
	if (sent.error) throw new Error(`resend broadcast send failed: ${sent.error.message}`);
	return data.id;
}

export async function alertEmail(subject: string, html: string): Promise<void> {
	const key = process.env.RESEND_API_KEY;
	if (!key) return; // caller logs — nothing else to do without email infra
	try {
		await new Resend(key).emails.send({ from: NEWSLETTER_FROM, to: [ALERT_EMAIL], subject, html });
	} catch (e) {
		console.error("[publish] failure alert email also failed:", e);
	}
}

export async function alertPublishFailure(doc: Doc, err: unknown): Promise<void> {
	const message = err instanceof Error ? err.message : String(err);
	console.error(`[publish] doc ${doc.id} (${doc.kind}) failed:`, message);
	await alertEmail(
		`Scheduled publish failed: ${doc.title}`,
		`<p><strong>${doc.title}</strong> (${doc.kind}) was scheduled for ${doc.scheduledFor?.toISOString() ?? "?"} but failed to publish.</p><pre>${message}</pre><p>The doc stays marked <em>failed</em> in the dashboard — fix and retry from the editor.</p>`,
	);
}
