// Public short-link redirect — no auth (this IS the link people click).
// GET /l/:slug → count click atomically, 302 to target. Unknown slug → /.
import type { APIEvent } from "@solidjs/start/server";
import { eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { shortLinks } from "~/db/schema";

export const GET = async (event: APIEvent) => {
	const [row] = await db
		.update(shortLinks)
		.set({ clicks: sql`${shortLinks.clicks} + 1` })
		.where(eq(shortLinks.slug, event.params.slug))
		.returning();
	return new Response(null, {
		status: 302,
		headers: { Location: row?.target ?? "/", "Referrer-Policy": "no-referrer" },
	});
};
