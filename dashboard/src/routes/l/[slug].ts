// Public short-link redirect — no auth (this IS the link people click).
// GET /l/:slug → count click atomically, 302 to target. Unknown slug → /.
// Bot/prefetcher UAs (LinkedInBot, email scanners, …) still get redirected —
// unfurls must work — but never count: `clicks` = human clicks only.
import type { APIEvent } from "@solidjs/start/server";
import { eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { shortLinks } from "~/db/schema";
import { isBotUA } from "~/lib/bot-ua";

export const GET = async (event: APIEvent) => {
	const ua = event.request.headers.get("user-agent");
	const [row] = isBotUA(ua)
		? await db.select().from(shortLinks).where(eq(shortLinks.slug, event.params.slug)).limit(1)
		: await db
				.update(shortLinks)
				.set({ clicks: sql`${shortLinks.clicks} + 1` })
				.where(eq(shortLinks.slug, event.params.slug))
				.returning();
	return new Response(null, {
		status: 302,
		headers: { Location: row?.target ?? "/", "Referrer-Policy": "no-referrer" },
	});
};
