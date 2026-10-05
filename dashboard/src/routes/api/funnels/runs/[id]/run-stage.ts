// "Run stage" — batch-run an api-method stage through its driver for queued
// items (shared runner: lib/funnel-stages.ts). Session or mc_ key guarded.
// POST /api/funnels/runs/:id/run-stage { stage, limit? } → { results, errors, firstError? }
import type { APIEvent } from "@solidjs/start/server";
import { funnelAuthed } from "~/lib/funnels";
import { runStageBatch } from "~/lib/funnel-stages";

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const POST = async (event: APIEvent) => {
	if (!(await funnelAuthed(event.request))) return json({ error: "Unauthorized" }, 401);
	const body = (await event.request.json().catch(() => ({}))) as { stage?: string; limit?: number };
	const r = await runStageBatch(event.params.id, body.stage ?? "", body.limit ?? 50);
	if (!r.ok) return json({ error: r.error }, 400);
	return json(r);
};
