import type { APIEvent } from "@solidjs/start/server";
import { eq, inArray } from "drizzle-orm";
import { getAuthedClient } from "~/lib/session";
import { db } from "~/db";
import { emailOutbox } from "~/db/schema";
import { sendOutboxDraft, saveDraftBody, scheduleOutboxDraft, unscheduleOutboxDraft } from "~/lib/email-outbox";
import { listTextVersions, getTextVersionDiff, deleteTextVersions } from "~/lib/crdt-text-db";

/**
 * /api/email/drafts/:id
 * GET  ?versions=1           → tracked-version list (no content)
 * GET  ?diff=N               → word-diff of version N vs N-1
 * PUT  { body?, subject?, to? } → update draft (body is CRDT-tracked)
 * POST { op: "send", body? }             → lint-gated send (agent drafts → pair)
 * POST { op: "schedule", sendAt, body?, overrideLint? } → lint-gated schedule
 * POST { op: "unschedule" }              → back to plain draft
 * POST { op: "discard" }                 → delete
 */
function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const GET = async (event: APIEvent) => {
	if (!(await getAuthedClient())) return json({ error: "Unauthorized" }, 401);
	const url = new URL(event.request.url);
	if (url.searchParams.has("versions")) {
		return json({ versions: await listTextVersions("email_draft", event.params.id) });
	}
	const diffVer = Number(url.searchParams.get("diff"));
	if (Number.isInteger(diffVer) && diffVer > 0) {
		const diff = await getTextVersionDiff("email_draft", event.params.id, diffVer);
		if (!diff) return json({ error: "Not found" }, 404);
		return json(diff);
	}
	return json({ error: "Missing ?versions or ?diff" }, 400);
};

export const PUT = async (event: APIEvent) => {
	if (!(await getAuthedClient())) return json({ error: "Unauthorized" }, 401);
	const body = (await event.request.json().catch(() => ({}))) as Record<string, string | undefined>;
	let version: number | null = null;
	if (body.body !== undefined) {
		version = await saveDraftBody(event.params.id, body.body);
		if (version === null) return json({ error: "not found" }, 404);
	}
	const [row] = await db
		.update(emailOutbox)
		.set({
			...(body.subject ? { subject: body.subject } : {}),
			...(body.to ? { toEmail: body.to } : {}),
		})
		.where(eq(emailOutbox.id, event.params.id))
		.returning();
	return json(row ? { ...row, version } : { error: "not found" }, row ? 200 : 404);
};

export const POST = async (event: APIEvent) => {
	if (!(await getAuthedClient())) return json({ error: "Unauthorized" }, 401);
	const body = (await event.request.json().catch(() => ({}))) as {
		op?: string;
		body?: string;
		overrideLint?: boolean;
		sendAt?: string;
	};
	if (body.op === "send") return json(await sendOutboxDraft(event.params.id, body.body, { overrideLint: body.overrideLint === true }));
	if (body.op === "schedule") {
		if (!body.sendAt) return json({ error: "sendAt required" }, 400);
		return json(
			await scheduleOutboxDraft(event.params.id, new Date(body.sendAt), {
				body: body.body,
				overrideLint: body.overrideLint === true,
			}),
		);
	}
	if (body.op === "unschedule") return json({ ok: await unscheduleOutboxDraft(event.params.id) });
	if (body.op === "discard") {
		await deleteTextVersions("email_draft", event.params.id);
		await db.delete(emailOutbox).where(eq(emailOutbox.id, event.params.id));
		return json({ ok: true });
	}
	return json({ error: "unknown op" }, 400);
};
