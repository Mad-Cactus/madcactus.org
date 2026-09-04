import type { APIEvent } from "@solidjs/start/server";
import { eq } from "drizzle-orm";
import { getAuthedClient } from "~/lib/session";
import { db } from "~/db";
import { emailOutbox } from "~/db/schema";
import { sendOutboxDraft } from "~/lib/email-queries";

/**
 * /api/email/drafts/:id
 * PUT  { body?, subject?, to? }          → update draft
 * POST { op: "send", body? }             → send (or discard)
 * POST { op: "discard" }                 → delete
 */
function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const PUT = async (event: APIEvent) => {
	if (!(await getAuthedClient())) return json({ error: "Unauthorized" }, 401);
	const body = (await event.request.json().catch(() => ({}))) as Record<string, string | undefined>;
	const [row] = await db
		.update(emailOutbox)
		.set({
			...(body.body ? { body: body.body } : {}),
			...(body.subject ? { subject: body.subject } : {}),
			...(body.to ? { toEmail: body.to } : {}),
		})
		.where(eq(emailOutbox.id, event.params.id))
		.returning();
	return json(row ?? { error: "not found" }, row ? 200 : 404);
};

export const POST = async (event: APIEvent) => {
	if (!(await getAuthedClient())) return json({ error: "Unauthorized" }, 401);
	const body = (await event.request.json().catch(() => ({}))) as { op?: string; body?: string };
	if (body.op === "send") return json(await sendOutboxDraft(event.params.id, body.body));
	if (body.op === "discard") {
		await db.delete(emailOutbox).where(eq(emailOutbox.id, event.params.id));
		return json({ ok: true });
	}
	return json({ error: "unknown op" }, 400);
};
