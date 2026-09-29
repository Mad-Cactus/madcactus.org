// Batch import into an open run — session or mc_ key guarded.
// POST /api/funnels/runs/:id/items
//   { items: [{ companyName, city?, state?, sourceUrl?, sourceKind?, rawData? }] }
//   Max 100 per call. Dedups within the run; skips companies already promoted
//   as prospects. Auto-writes hq_state (state field) and industry_type
//   (rawData.industryType) results with method=source when the row carries
//   the evidence.
import type { APIEvent } from "@solidjs/start/server";
import { eq, inArray } from "drizzle-orm";
import { db } from "~/db";
import { funnelItems, funnelStageResults, outreachProspects } from "~/db/schema";
import { funnelAuthed, getRunStages } from "~/lib/funnels";

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type ImportRow = {
	companyName?: string;
	city?: string | null;
	state?: string | null;
	sourceUrl?: string | null;
	sourceKind?: string | null;
	rawData?: Record<string, unknown> | null;
};

const normState = (s?: string | null) => {
	const t = (s ?? "").trim().toLowerCase();
	return t === "in" || t === "indiana" ? "IN" : t ? t.toUpperCase().slice(0, 2) : null;
};

export const POST = async (event: APIEvent) => {
	if (!(await funnelAuthed(event.request))) return json({ error: "Unauthorized" }, 401);
	const info = await getRunStages(event.params.id);
	if (!info) return json({ error: "Run not found" }, 404);
	if (info.run.status !== "open") return json({ error: "Run is closed — reopen by creating a new run" }, 400);
	const body = (await event.request.json().catch(() => ({}))) as { items?: ImportRow[] };
	const rows = (body.items ?? []).filter((r) => (r.companyName ?? "").trim());
	if (rows.length === 0) return json({ error: "items[] with companyName required" }, 400);
	if (rows.length > 100) return json({ error: "Max 100 items per call" }, 400);

	// skip companies that already made it to the CRM
	const names = [...new Set(rows.map((r) => r.companyName!.trim()))];
	const promoted = await db
		.select({ company: outreachProspects.company })
		.from(outreachProspects)
		.where(inArray(outreachProspects.company, names));
	const promotedSet = new Set(promoted.map((p) => p.company.toLowerCase()));

	let imported = 0;
	let skippedPromoted = 0;
	let duplicated = 0;
	for (const row of rows) {
		const name = row.companyName!.trim();
		if (promotedSet.has(name.toLowerCase())) {
			skippedPromoted++;
			continue;
		}
		const inserted = await db
			.insert(funnelItems)
			.values({
				runId: event.params.id,
				companyName: name,
				city: row.city?.trim() || null,
				state: normState(row.state),
				sourceUrl: row.sourceUrl?.trim() || null,
				sourceKind: row.sourceKind?.trim() || null,
				rawData: row.rawData ?? null,
			})
			.onConflictDoNothing({ target: [funnelItems.runId, funnelItems.companyName] })
			.returning({ id: funnelItems.id, state: funnelItems.state });
		if (inserted.length === 0) {
			duplicated++;
			continue;
		}
		imported++;
		// auto stage verdicts from pull evidence (method=source)
		const item = inserted[0];
		const auto: { stage: string; verdict: "pass" | "fail"; note: string | null }[] = [];
		if (item.state) {
			auto.push({
				stage: "hq_state",
				verdict: item.state === "IN" ? "pass" : "fail",
				note: [row.city?.trim(), item.state].filter(Boolean).join(", ") || null,
			});
		}
		const industry = typeof row.rawData?.industryType === "string" ? row.rawData.industryType.trim() : "";
		if (industry) auto.push({ stage: "industry_type", verdict: "pass", note: industry });
		for (const a of auto) {
			await db
				.insert(funnelStageResults)
				.values({
					itemId: item.id,
					stage: a.stage,
					verdict: a.verdict,
					note: a.note,
					evidenceUrl: row.sourceUrl?.trim() || null,
					method: "source",
				})
				.onConflictDoNothing({ target: [funnelStageResults.itemId, funnelStageResults.stage] });
		}
	}
	return json({ ok: true, imported, duplicated, skippedPromoted });
};
