// Funnel run detail — session or mc_ key guarded.
// GET  /api/funnels/runs/:id → { run, stages, items, results, summary }
// POST /api/funnels/runs/:id { action: "close" } → close the run (no more imports)
import type { APIEvent } from "@solidjs/start/server";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "~/db";
import { funnelItems, funnelRuns, funnelStageResults } from "~/db/schema";
import { funnelAuthed, getRunStages, getSummary } from "~/lib/funnels";

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const GET = async (event: APIEvent) => {
	if (!(await funnelAuthed(event.request))) return json({ error: "Unauthorized" }, 401);
	const info = await getRunStages(event.params.id);
	if (!info) return json({ error: "Run not found" }, 404);
	const items = await db
		.select()
		.from(funnelItems)
		.where(eq(funnelItems.runId, event.params.id))
		.orderBy(asc(funnelItems.companyName));
	const results = items.length
		? await db
				.select()
				.from(funnelStageResults)
				.where(inArray(funnelStageResults.itemId, items.map((i) => i.id)))
				.orderBy(asc(funnelStageResults.checkedAt))
		: [];
	const summary = await getSummary(event.params.id, info.stages);
	return json({ run: info.run, stages: info.stages, items, results, summary });
};

export const POST = async (event: APIEvent) => {
	if (!(await funnelAuthed(event.request))) return json({ error: "Unauthorized" }, 401);
	const body = (await event.request.json().catch(() => ({}))) as { action?: string };
	if (body.action !== "close") return json({ error: "Unsupported action" }, 400);
	await db.update(funnelRuns).set({ status: "closed", closedAt: new Date() }).where(eq(funnelRuns.id, event.params.id));
	return json({ ok: true });
};
