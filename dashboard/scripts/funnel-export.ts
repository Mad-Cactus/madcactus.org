// Export all funnel data (funnels, runs, items, stage results) to JSON so a
// local working run can be restored into production.
//   cd dashboard && bun scripts/funnel-export.ts [out.json]
// Default out: scripts/funnel-data.json (gitignored — contains real data).
import { db } from "~/db";
import { entityLinks, funnelItems, funnelRuns, funnelStageResults, funnels } from "~/db/schema";

const out = process.argv[2] ?? "scripts/funnel-data.json";
const dump = {
	exportedAt: new Date().toISOString(),
	funnels: await db.select().from(funnels),
	runs: await db.select().from(funnelRuns),
	items: await db.select().from(funnelItems),
	results: await db.select().from(funnelStageResults),
	links: await db.select().from(entityLinks),
};
await Bun.write(out, JSON.stringify(dump, null, "\t"));
console.log(
	`exported → ${out}: ${dump.funnels.length} funnels, ${dump.runs.length} runs, ${dump.items.length} items, ${dump.results.length} verdicts, ${dump.links.length} links`,
);
