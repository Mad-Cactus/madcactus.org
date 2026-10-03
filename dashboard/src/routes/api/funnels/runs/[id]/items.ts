// Batch import into an open run — session or mc_ key guarded.
// POST /api/funnels/runs/:id/items
//   { items: [{ companyName, city?, state?, sourceUrl?, sourceKind?, rawData? }] }
//   Max 100 per call. Dedups within the run; skips companies already promoted
//   as prospects. Auto-writes hq_state (state field) and industry_type
//   (rawData.industryType) results with method=source when the row carries
//   the evidence.
import type { APIEvent } from "@solidjs/start/server";
import { funnelAuthed, getRunStages, importRunItems, type ImportRow } from "~/lib/funnels";

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const POST = async (event: APIEvent) => {
	if (!(await funnelAuthed(event.request))) return json({ error: "Unauthorized" }, 401);
	const info = await getRunStages(event.params.id);
	if (!info) return json({ error: "Run not found" }, 404);
	if (info.run.status !== "open") return json({ error: "Run is closed — reopen by creating a new run" }, 400);
	const body = (await event.request.json().catch(() => ({}))) as { items?: ImportRow[] };
	const rows = (body.items ?? []).filter((r) => (r.companyName ?? "").trim());
	if (rows.length === 0) return json({ error: "items[] with companyName required" }, 400);
	if (rows.length > 100) return json({ error: "Max 100 items per call" }, 400);
	return json({ ok: true, ...(await importRunItems(event.params.id, rows)) });
};
