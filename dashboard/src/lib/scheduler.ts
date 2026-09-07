// Publish scheduler — one 60s ticker inside the dashboard process. Claims due
// docs (LinkedIn/newsletter) AND scheduled Gmail drafts atomically, dispatches
// each, then marks published/sent or failed (+ email alert). Stale in-flight
// rows (process died mid-dispatch) are failed after 5 min.
import { and, eq, inArray, lte } from "drizzle-orm";
import { db } from "~/db";
import { docs, emailOutbox } from "~/db/schema";
import { alertEmail, alertPublishFailure, publishDoc } from "~/lib/publish";
import { sendOutboxInner } from "~/lib/email-outbox";

const TICK_MS = 60_000;
const STALE_MS = 5 * 60_000;

export async function tick(): Promise<{ docs: number; emails: number }> {
	let docsPublished = 0;
	let emailsSent = 0;
	// reclaim crashed dispatches
	await db
		.update(docs)
		.set({ status: "failed", publishError: "dispatch stalled — requeued as failed, retry from the editor" })
		.where(and(eq(docs.status, "publishing"), lte(docs.updatedAt, new Date(Date.now() - STALE_MS))));

	const due = db
		.select({ id: docs.id })
		.from(docs)
		.where(and(eq(docs.status, "scheduled"), lte(docs.scheduledFor, new Date())))
		.orderBy(docs.scheduledFor)
		.limit(10);
	const claimed = await db
		.update(docs)
		.set({ status: "publishing", publishError: null })
		.where(inArray(docs.id, due))
		.returning();

	for (const doc of claimed) {
		try {
			await publishDoc(doc);
			await db.update(docs).set({ status: "published", publishedAt: new Date() }).where(eq(docs.id, doc.id));
			docsPublished++;
		} catch (err) {
			await db
				.update(docs)
				.set({ status: "failed", publishError: err instanceof Error ? err.message : String(err) })
				.where(eq(docs.id, doc.id));
			await alertPublishFailure(doc, err);
		}
	}

	// scheduled Gmail sends — voice-lint gate already passed at schedule time,
	// so the tick sends unguarded. sendOutboxDraft marks sent/failed itself.
	await db
		.update(emailOutbox)
		.set({ status: "failed", error: "scheduled send stalled — draft kept, hit Send to retry" })
		.where(and(eq(emailOutbox.status, "sending"), lte(emailOutbox.updatedAt, new Date(Date.now() - STALE_MS))));

	const dueDrafts = db
		.select({ id: emailOutbox.id })
		.from(emailOutbox)
		.where(and(eq(emailOutbox.status, "draft"), lte(emailOutbox.sendAt, new Date())))
		.limit(10);
	const claimedDrafts = await db
		.update(emailOutbox)
		.set({ status: "sending" })
		.where(inArray(emailOutbox.id, dueDrafts))
		.returning({ id: emailOutbox.id, toEmail: emailOutbox.toEmail, subject: emailOutbox.subject });

	for (const d of claimedDrafts) {
		const r = await sendOutboxInner(d.id, undefined, { overrideLint: true });
		if (r.ok) emailsSent++;
		else if (!("blocked" in r)) {
			// early exits (no Gmail account, etc.) return without touching status —
			// don't leave the row stuck in 'sending' (it would wait for stale reclaim)
			await db
				.update(emailOutbox)
				.set({ status: "failed", error: r.error })
				.where(and(eq(emailOutbox.id, d.id), inArray(emailOutbox.status, ["sending", "draft"])));
			console.error(`[scheduler] scheduled email to ${d.toEmail} failed: ${r.error}`);
			await alertEmail(
				`Scheduled email failed: ${d.subject}`,
				`<p>Your scheduled email to <strong>${d.toEmail}</strong> (“${d.subject}”) failed to send.</p><pre>${r.error}</pre><p>The draft is kept (marked failed) in the Email tab — hit Send to retry.</p>`,
			);
		}
	}

	return { docs: docsPublished, emails: emailsSent };
}

const KEY = Symbol.for("madcactus.publish-scheduler");

export function startScheduler(): void {
	const g = globalThis as Record<symbol, unknown>;
	if (g[KEY]) return;
	g[KEY] = true;
	setInterval(() => void tick().catch((e) => console.error("[scheduler] tick failed:", e)), TICK_MS).unref();
	void tick().catch((e) => console.error("[scheduler] initial tick failed:", e));
}
