// Scheduled funnel automation — runs from the publish scheduler tick (in-process
// 60s ticker + Supabase cron pings). Pure code: no agent, no tokens. Each
// enabled funnel_schedules row drives:
//   discovery (every N days): pull new companies from its source (FMCSA census,
//     keyless) into an open run — auto-creating a monthly run when none is open
//   enrich (daily): headcount (Prospeo, enrichPerDay budget) → revenue +
//     ai_signal (cache reads, ~free) → tech_team (Apollo, techPerDay budget)
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "~/db";
import { funnelRuns, funnelSchedules, funnels } from "~/db/schema";
import { importRunItems } from "~/lib/funnels";
import { runStageBatch } from "~/lib/funnel-stages";
import { discoverIndianaBrokers } from "~/lib/fmcsa";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The funnel's open run; auto-creates a monthly one so discovery never stalls. */
async function openRunFor(funnelId: string, funnelName: string) {
	const [open] = await db
		.select()
		.from(funnelRuns)
		.where(and(eq(funnelRuns.funnelId, funnelId), eq(funnelRuns.status, "open")))
		.orderBy(desc(funnelRuns.createdAt))
		.limit(1);
	if (open) return open;
	const [created] = await db
		.insert(funnelRuns)
		.values({ funnelId, source: "scheduler", note: `auto ${new Date().toISOString().slice(0, 7)}` })
		.returning();
	console.log(`[funnel-scheduler] ${funnelName}: no open run — created ${created.note}`);
	return created;
}

export async function runScheduledFunnels(): Promise<{ funnels: number; discovered: number; verdicts: number }> {
	const rows = await db
		.select({ schedule: funnelSchedules, funnel: funnels })
		.from(funnelSchedules)
		.innerJoin(funnels, eq(funnels.id, funnelSchedules.funnelId))
		.where(eq(funnelSchedules.enabled, true));

	let discovered = 0;
	let verdicts = 0;
	let ran = 0;

	for (const { schedule, funnel } of rows) {
		try {
			const run = await openRunFor(funnel.id, funnel.name);

			// discovery — every discoveryIntervalDays when a source is set
			const discoveryDue =
				schedule.discoverySource === "fmcsa" &&
				(!schedule.lastDiscoveryAt || Date.now() - schedule.lastDiscoveryAt.getTime() >= schedule.discoveryIntervalDays * DAY_MS);
			if (discoveryDue) {
				const companies = await discoverIndianaBrokers(200);
				const res = await importRunItems(run.id, companies);
				discovered += res.imported;
				await db.update(funnelSchedules).set({ lastDiscoveryAt: new Date() }).where(eq(funnelSchedules.id, schedule.id));
				console.log(`[funnel-scheduler] ${funnel.name}: +${res.imported} new from FMCSA`);
			}

			// enrichment — once per day, stages in gate order
			// atomic claim: stamp lastEnrichAt BEFORE the (slow) run so a concurrent
			// tick 60s later can't double-burn the day's enrichment budget — the
			// same outer-guard lesson as the docs claim in scheduler.ts
			const cutoff = new Date(Date.now() - DAY_MS);
			const claim = schedule.lastEnrichAt === null || schedule.lastEnrichAt < cutoff;
			if (claim) {
				const claimed = await db
					.update(funnelSchedules)
					.set({ lastEnrichAt: new Date() })
					.where(and(eq(funnelSchedules.id, schedule.id), or(isNull(funnelSchedules.lastEnrichAt), lt(funnelSchedules.lastEnrichAt, cutoff))))
					.returning({ id: funnelSchedules.id });
				if (claimed.length === 0) continue;
				for (const [stage, limit] of [
					["headcount", schedule.enrichPerDay],
					["revenue_band", schedule.enrichPerDay],
					["ai_signal", schedule.enrichPerDay],
					["tech_team", schedule.techPerDay],
				] as const) {
					const r = await runStageBatch(run.id, stage, limit);
					if (r.ok) verdicts += r.results;
					else if (!r.error.includes("not an api stage")) console.error(`[funnel-scheduler] ${funnel.name} ${stage}: ${r.error}`);
				}
			}
			ran++;
		} catch (e) {
			// one funnel failing must never kill the tick
			console.error(`[funnel-scheduler] ${funnel.name} failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
	return { funnels: ran, discovered, verdicts };
}
