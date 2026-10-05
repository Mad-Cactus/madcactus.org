// Restore a funnel-data.json export into another database (e.g. production
// via the Fly proxy). Idempotent: everything upserts with ON CONFLICT DO
// NOTHING, so re-running never duplicates. Promoted items keep their verdicts;
// prospectId is dropped when the prospect doesn't exist in the target DB.
//   cd dashboard && DATABASE_URL=<target> bun scripts/funnel-import.ts [in.json]
import { inArray } from "drizzle-orm";
import { db } from "~/db";
import { entityLinks, funnelItems, funnelRuns, funnelStageResults, funnels, outreachProspects } from "~/db/schema";

// JSON.parse returns ISO strings; drizzle timestamp columns want Date objects
const reviveDates = (rows: Record<string, unknown>[]) =>
	rows.map((r) => {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(r)) out[k] = typeof v === "string" && /At$/.test(k) ? new Date(v) : v;
		return out;
	});

const file = process.argv[2] ?? "scripts/funnel-data.json";
const raw = JSON.parse(await Bun.file(file).text());
const dump = {
	funnels: reviveDates(raw.funnels),
	runs: reviveDates(raw.runs),
	items: reviveDates(raw.items),
	results: reviveDates(raw.results),
	links: reviveDates(raw.links),
} as {
	funnels: (typeof funnels.$inferSelect)[];
	runs: (typeof funnelRuns.$inferSelect)[];
	items: (typeof funnelItems.$inferSelect)[];
	results: (typeof funnelStageResults.$inferSelect)[];
	links: (typeof entityLinks.$inferSelect)[];
};

// If the target already has a Freight ICP (its own lazy seed), re-point runs
// at it instead of creating a second funnel row.
let funnelIdMap = new Map<string, string>();
for (const f of dump.funnels) {
	const [existing] = await db.select({ id: funnels.id }).from(funnels).where(inArray(funnels.name, [f.name])).limit(1);
	if (existing) {
		funnelIdMap.set(f.id, existing.id);
		continue;
	}
	await db.insert(funnels).values(f).onConflictDoNothing();
	funnelIdMap.set(f.id, f.id);
}

for (const r of dump.runs) {
	await db
		.insert(funnelRuns)
		.values({ ...r, funnelId: funnelIdMap.get(r.funnelId) ?? r.funnelId })
		.onConflictDoNothing();
}

// drop prospect links whose prospect doesn't exist in the target
const promotedIds = [...new Set(dump.items.filter((i) => i.prospectId).map((i) => i.prospectId!))];
const existingProspects = promotedIds.length
	? new Set((await db.select({ id: outreachProspects.id }).from(outreachProspects).where(inArray(outreachProspects.id, promotedIds))).map((p) => p.id))
	: new Set<string>();
for (const it of dump.items) {
	await db
		.insert(funnelItems)
		.values({ ...it, prospectId: it.prospectId && existingProspects.has(it.prospectId) ? it.prospectId : null })
		.onConflictDoNothing();
}

for (const r of dump.results) {
	await db.insert(funnelStageResults).values(r).onConflictDoNothing();
}
for (const l of dump.links) {
	await db.insert(entityLinks).values(l).onConflictDoNothing();
}

console.log(
	`imported from ${file}: ${dump.funnels.length} funnels, ${dump.runs.length} runs, ${dump.items.length} items, ${dump.results.length} verdicts, ${dump.links.length} links (idempotent — existing rows skipped)`,
);
