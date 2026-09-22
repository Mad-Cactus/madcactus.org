// The newsletter seal image IS the open tracker: the email footer's img src
// lands here, we log the open (deduped — one row per doc+recipient, so
// Resend/Gmail prefetches and repeats never inflate), then 302 to the static
// seal. ?r={{email}} is Resend's per-recipient substitution; an unsubstituted
// literal or missing param just logs per-doc (anon).
import type { APIEvent } from "@solidjs/start/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { docs, newsletterEvents } from "~/db/schema";
import { UUID_RE } from "~/lib/uuid";

export const GET = async (event: APIEvent) => {
	const docId = event.params.docId ?? "";
	if (UUID_RE.test(docId)) {
		try {
			const [doc] = await db.select({ id: docs.id }).from(docs).where(eq(docs.id, docId)).limit(1);
			if (doc) {
				const url = new URL(event.request.url);
				const raw = (url.searchParams.get("r") ?? "").trim().toLowerCase();
				// only a real-looking address counts as a person; the unsubstituted
				// "{{email}}" literal or junk falls back to per-doc anon
				const recipient = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : null;
				// insert-first dedup: unique (doc, person) — the counter is unique
				// openers, not raw pixel loads
				const inserted = await db
					.insert(newsletterEvents)
					.values({ eventId: `pixel:${docId}:${recipient ?? "anon"}`, type: "open", docId, recipient })
					.onConflictDoNothing({ target: newsletterEvents.eventId })
					.returning({ id: newsletterEvents.id });
				if (inserted.length) {
					await db
						.update(docs)
						.set({ opens: sql`${docs.opens} + 1` })
						.where(and(eq(docs.id, docId)));
				}
			}
		} catch (e) {
			// never break the image over a logging hiccup
			console.error("[track-open] failed:", e);
		}
	}
	return new Response(null, {
		status: 302,
		headers: { Location: "/cactus-seal.png", "Cache-Control": "public, max-age=604800" },
	});
};
