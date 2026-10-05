// Record a stage verdict (upsert per item+stage) — session or mc_ key guarded.
// POST /api/funnels/results { itemId, stage, verdict, evidenceUrl?, note?, method? }
// Triggers promotion on all-stages-pass and un-approves the linked prospect on a fail.
import type { APIEvent } from "@solidjs/start/server";
import { and, eq } from "drizzle-orm";
import { db } from "~/db";
import { funnelItems, funnelStageResults } from "~/db/schema";
import { FUNNEL_METHODS } from "~/db/schema";
import { applyVerdictConsequences, funnelAuthed, getRunStages } from "~/lib/funnels";

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const POST = async (event: APIEvent) => {
	if (!(await funnelAuthed(event.request))) return json({ error: "Unauthorized" }, 401);
	const body = (await event.request.json().catch(() => ({}))) as {
		itemId?: string;
		stage?: string;
		verdict?: string;
		evidenceUrl?: string;
		note?: string;
		method?: string;
	};
	if (!body.itemId || !body.stage || !["pass", "fail"].includes(body.verdict ?? "")) {
		return json({ error: "itemId, stage, verdict (pass|fail) required" }, 400);
	}
	const method = FUNNEL_METHODS.includes((body.method ?? "") as never) ? body.method! : "human";

	const [item] = await db
		.select({ id: funnelItems.id, runId: funnelItems.runId })
		.from(funnelItems)
		.where(eq(funnelItems.id, body.itemId))
		.limit(1);
	if (!item) return json({ error: "Unknown itemId" }, 404);
	const info = await getRunStages(item.runId);
	if (!info || !info.stages.some((s) => s.key === body.stage)) return json({ error: "Unknown stage" }, 400);

	const values = {
		verdict: body.verdict!,
		evidenceUrl: body.evidenceUrl?.trim() || null,
		note: body.note?.trim() || null,
		method,
		checkedAt: new Date(),
	};
	const [existing] = await db
		.select({ id: funnelStageResults.id })
		.from(funnelStageResults)
		.where(and(eq(funnelStageResults.itemId, body.itemId), eq(funnelStageResults.stage, body.stage)))
		.limit(1);
	if (existing) {
		await db.update(funnelStageResults).set(values).where(eq(funnelStageResults.id, existing.id));
	} else {
		await db.insert(funnelStageResults).values({ itemId: body.itemId, stage: body.stage, ...values });
	}
	await applyVerdictConsequences(body.itemId, info.stages);
	return json({ ok: true });
};
