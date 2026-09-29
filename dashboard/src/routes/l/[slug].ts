// Public short-link redirect — no auth (this IS the link people click).
// GET /l/:slug → count click atomically, 302 to target. Unknown slug → /.
// Bot/prefetcher UAs (LinkedInBot, email scanners, …) still get redirected —
// unfurls must work — but never count: `clicks` = human clicks only.
import type { APIEvent } from "@solidjs/start/server";
import { eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { newsletterEvents, shortLinks } from "~/db/schema";
import { isBotUA } from "~/lib/bot-ua";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const GET = async (event: APIEvent) => {
	const ua = event.request.headers.get("user-agent");
	const [row] = isBotUA(ua)
		? await db.select().from(shortLinks).where(eq(shortLinks.slug, event.params.slug)).limit(1)
		: await db
				.update(shortLinks)
				.set({ clicks: sql`${shortLinks.clicks} + 1` })
				.where(eq(shortLinks.slug, event.params.slug))
				.returning();
	// email clicks carry ?r={{email}} (Resend's per-recipient substitution —
	// see perPersonLinks in publish-core). Social clicks have no r and stay
	// aggregate on short_links.clicks. Logging never blocks the redirect.
	const r = new URL(event.request.url).searchParams.get("r")?.trim().toLowerCase() ?? "";
	if (row && EMAIL_RE.test(r)) {
		await db
			.insert(newsletterEvents)
			.values({
				eventId: `click:${event.params.slug}:${r}:${Date.now()}`,
				type: "click",
				docId: row.docId ?? null,
				recipient: r,
			})
			.catch((e) => console.error("[short-link] click log failed:", e));
	}
	return new Response(null, {
		status: 302,
		headers: { Location: row?.target ?? "/", "Referrer-Policy": "no-referrer" },
	});
};
