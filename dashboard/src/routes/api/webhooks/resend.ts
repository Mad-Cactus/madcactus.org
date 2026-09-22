// Resend webhook receiver — CLICKS land on the sending doc (per person).
// Opens are counted by our own seal pixel (/api/track/open) — Resend's
// email.opened events are ignored here so opens never double-count.
// Signed (Svix scheme — see ~/lib/resend-webhook) and deduped by the svix-id
// header in resend_events — Resend retries at-least-once, so a replay must
// not double-bump a counter.
import type { APIEvent } from "@solidjs/start/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { docs, resendEvents } from "~/db/schema";
import { verifySvixSignature } from "~/lib/resend-webhook";

/** Bump the doc's counter for this event, deduped by event id. The recipient
 *  (payload data.to) is stored so clicks match against ICP prospects later. */
async function record(
	eventId: string,
	type: "email.opened" | "email.clicked",
	broadcastId: string | undefined,
	recipient: string | undefined,
) {
	if (!broadcastId) return { ok: false, reason: "no broadcast_id" };
	const [doc] = await db
		.select({ id: docs.id })
		.from(docs)
		.where(eq(docs.resendBroadcastId, broadcastId))
		.limit(1);
	if (!doc) return { ok: false, reason: `no doc for broadcast ${broadcastId}` };
	// insert-first dedup: a repeated svix-id wins the unique index and is skipped
	const inserted = await db
		.insert(resendEvents)
		.values({ eventId, type, docId: doc.id, recipient: recipient?.toLowerCase() || null })
		.onConflictDoNothing({ target: resendEvents.eventId })
		.returning({ id: resendEvents.id });
	if (!inserted.length) return { ok: true, deduped: true };
	if (type === "email.opened") {
		await db.update(docs).set({ opens: sql`${docs.opens} + 1` }).where(and(eq(docs.id, doc.id)));
	} else {
		await db.update(docs).set({ clicks: sql`${docs.clicks} + 1` }).where(and(eq(docs.id, doc.id)));
	}
	return { ok: true };
}

export const POST = async (event: APIEvent) => {
	const secret = process.env.RESEND_WEBHOOK_SECRET;
	const id = event.request.headers.get("svix-id");
	const timestamp = event.request.headers.get("svix-timestamp");
	const signatures = event.request.headers.get("svix-signature");
	const body = await event.request.text();
	if (!secret || !id || !timestamp || !signatures) {
		return new Response("unauthorized", { status: 401 });
	}
	if (!verifySvixSignature(id, timestamp, body, signatures, secret)) {
		return new Response("invalid signature", { status: 403 });
	}
	let payload: { type?: string; data?: { broadcast_id?: string; to?: string[] | string } };
	try {
		payload = JSON.parse(body);
	} catch {
		return new Response("bad payload", { status: 400 });
	}
	if (payload.type === "email.clicked") {
		const to = payload.data?.to;
		const recipient = Array.isArray(to) ? to[0] : typeof to === "string" ? to : undefined;
		await record(id, payload.type, payload.data?.broadcast_id, recipient).catch((e) => {
			// never 500 on a storage hiccup — Resend would retry forever; log and ack
			console.error("[resend-webhook] record failed:", e);
		});
	}
	return new Response(null, { status: 200 });
};
