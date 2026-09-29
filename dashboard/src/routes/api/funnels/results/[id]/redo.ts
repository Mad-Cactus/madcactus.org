// Redo a stage verdict — one click clears the stage and re-queues the item.
// POST /api/funnels/results/:id/redo → { ok }
// Per the redo contract: icpApproved on a promoted prospect stays true until a
// `fail` verdict lands (via POST /api/funnels/results) — redo itself only deletes.
import type { APIEvent } from "@solidjs/start/server";
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { funnelStageResults } from "~/db/schema";
import { funnelAuthed } from "~/lib/funnels";

export const POST = async (event: APIEvent) => {
	if (!(await funnelAuthed(event.request))) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
	}
	const deleted = await db.delete(funnelStageResults).where(eq(funnelStageResults.id, event.params.id)).returning({ id: funnelStageResults.id });
	if (deleted.length === 0) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
	return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
};
