import { inArray } from "drizzle-orm";
import type { APIEvent } from "@solidjs/start/server";
import { getAuthedClient } from "~/lib/session";
import { db } from "~/db";
import { emailOutbox } from "~/db/schema";

/** GET /api/email/drafts — open drafts in the outbox. */
export const GET = async () => {
	if (!(await getAuthedClient())) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
	}
	// draft + failed: failed scheduled sends stay visible for retry instead of vanishing
	const rows = await db.select().from(emailOutbox).where(inArray(emailOutbox.status, ["draft", "failed"]));
	return new Response(JSON.stringify(rows), { headers: { "Content-Type": "application/json" } });
};

/** POST /api/email/drafts — manual compose. */
export const POST = async (event: APIEvent) => {
	if (!(await getAuthedClient())) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
	}
	const body = (await event.request.json().catch(() => ({}))) as Record<string, string | undefined>;
	if (!body.to || !body.body) {
		return new Response(JSON.stringify({ error: "to and body required" }), { status: 400 });
	}
	const [row] = await db
		.insert(emailOutbox)
		.values({
			toEmail: body.to,
			subject: body.subject || "(no subject)",
			body: body.body,
			threadId: body.threadId ?? null,
		})
		.returning();
	return new Response(JSON.stringify(row), { headers: { "Content-Type": "application/json" } });
};
