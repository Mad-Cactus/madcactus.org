// Publish dispatch: a doc of kind "post" goes to LinkedIn, "newsletter" goes
// out as a Resend broadcast to the Cactus Dispatch audience. Failures email
// the owner — a scheduled publish must never die silently.
// Pure transforms live in publish-core.ts (client-safe); re-exported here for
// the scheduler and existing imports.
import { Resend } from "resend";
import type { Doc } from "~/db/schema";
import { postToLinkedIn, commentOnLinkedIn } from "~/lib/social";
import { markdownToPostText, newsletterSubject, markdownToHtml, EMAIL_FOOTER_HTML } from "~/lib/publish-core";

export { markdownToPostText, newsletterSubject, markdownToHtml, EMAIL_FOOTER_HTML };

const ALERT_EMAIL = process.env.ALERT_EMAIL ?? "cpfeifer@madcactus.org";
const NEWSLETTER_FROM = process.env.NEWSLETTER_FROM ?? "Collin Pfeifer <dispatch@madcactus.org>";

export async function publishDoc(doc: Doc): Promise<string> {
	if (doc.kind === "post") {
		const urn = await postToLinkedIn(markdownToPostText(doc.markdown));
		// The post is already live — a failed first comment must not mark the
		// doc failed (a retry would double-post). Alert instead.
		const fc = doc.firstComment?.trim();
		if (fc) {
			try {
				await commentOnLinkedIn(urn, fc);
			} catch (err) {
				await alertEmail(`LinkedIn first comment failed: ${doc.title}`, `<p>The post published, but the first comment could not be added.</p><pre>${err instanceof Error ? err.message : String(err)}</pre><p>Comment manually: <strong>${fc}</strong></p>`);
			}
		}
		return urn;
	}
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
		html: markdownToHtml(doc.markdown, "email") + EMAIL_FOOTER_HTML,
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
