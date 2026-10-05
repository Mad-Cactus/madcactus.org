// Funnel stage batch runner — shared by the dashboard "Run stage" button and
// the scheduler's daily automation. Drivers: Prospeo (headcount, revenue —
// 0 credits on miss), Apollo (tech_team), cache reads (ai_signal roster/site).
import { eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { funnelItems, funnelStageResults } from "~/db/schema";
import { applyVerdictConsequences, getQueue, getRunStages } from "~/lib/funnels";
import { apolloConfigured, apolloHeadcount, apolloTechTitleHits } from "~/lib/enrich-apollo";
import {
	prospeoCompanyRoster,
	prospeoConfigured,
	prospeoEnrichBatch,
	rangeMidpoint,
	type ProspeoCompany,
	type ProspeoRoster,
} from "~/lib/enrich-prospeo";
import { scoreAiSignal, scoreRoster, scanSite } from "~/lib/ai-signal";

const M = 1_000_000;

export type BatchResult = { ok: true; results: number; errors: number; firstError?: string } | { ok: false; error: string };

/** One Prospeo call carries the whole firmographic payload — cache it on the
 *  item so later stages (revenue) read it free instead of re-enriching. */
async function cacheProspeo(itemId: string, co: ProspeoCompany | null) {
	await db
		.update(funnelItems)
		.set({
			rawData: sql`jsonb_set(coalesce(${funnelItems.rawData}, '{}'::jsonb), '{prospeo}', ${JSON.stringify(
				co ? { matched: true, ...co } : { matched: false },
			)}::jsonb)`,
		})
		.where(eq(funnelItems.id, itemId));
}

/** Same pattern for the people roster — cached so re-runs and re-scores cost
 *  zero credits (Prospeo additionally dedupes identical pages free for 30d). */
async function cacheRoster(itemId: string, roster: ProspeoRoster) {
	await db
		.update(funnelItems)
		.set({
			rawData: sql`jsonb_set(coalesce(${funnelItems.rawData}, '{}'::jsonb), '{roster}', ${JSON.stringify(roster)}::jsonb)`,
		})
		.where(eq(funnelItems.id, itemId));
}

/** Keyless page fetch for the site scan — a dead site skips the scan, it
 *  never fails the stage. ponytail: 500KB cap covers any real homepage. */
async function fetchPage(url: string): Promise<string | null> {
	try {
		const r = await fetch(url, {
			signal: AbortSignal.timeout(10_000),
			headers: { "User-Agent": "Mozilla/5.0 (compatible; madcactus-icp/1.0)" },
		});
		if (!r.ok) return null;
		return (await r.text()).slice(0, 500_000);
	} catch {
		return null;
	}
}

/** Internal href paths for subpage scanning (assets and hashes dropped). */
function internalLinks(html: string): string[] {
	const out: string[] = [];
	for (const m of html.matchAll(/href=["'](\/[^"'#]*)["']/gi)) {
		const path = m[1];
		if (/\.(css|js|png|jpe?g|gif|svg|ico|pdf|woff2?|mp4|webp)(\?|$)/i.test(path)) continue;
		if (/^(mailto:|tel:)/.test(path)) continue;
		if (!out.includes(path)) out.push(path);
	}
	return out;
}

/** Batch-run an api-method stage over its queue. `limit` bounds credit spend. */
export async function runStageBatch(runId: string, stageKey: string, limit = 50): Promise<BatchResult> {
	const info = await getRunStages(runId);
	const stage = info?.stages.find((s) => s.key === stageKey);
	if (!info || !stage) return { ok: false, error: "Run not found or unknown stage" };
	if (stage.method !== "api") return { ok: false, error: `Stage ${stageKey} is not an api stage` };
	if (stageKey === "tech_team" && !apolloConfigured()) return { ok: false, error: "Tech-team stage needs APOLLO_API_KEY" };
	if (stageKey !== "tech_team" && !prospeoConfigured()) return { ok: false, error: `${stageKey} stage needs PROSPEO_API_KEY` };

	const queue = await getQueue(runId, stageKey);
	if (!queue) return { ok: false, error: "Run not found" };
	const items = queue.slice(0, Math.min(Math.max(Math.trunc(limit), 1), 500));

	let okCount = 0;
	let errors = 0;
	let firstError = "";

	// Prospeo firmographic stages: one bulk request per 50 companies instead of
	// N singles — same credit cost (per match), one rate-limit slot, no 429
	// storms. ai_signal is excluded: it reads the headcount run's cached payload
	// and its own cached roster instead.
	const enriched = new Map<string, ProspeoCompany | null>();
	if ((stageKey === "headcount" || stageKey === "revenue_band") && prospeoConfigured() && items.length > 0) {
		try {
			for (let i = 0; i < items.length; i += 50) {
				const chunk = items.slice(i, i + 50);
				const res = await prospeoEnrichBatch(chunk.map((c) => c.companyName));
				for (const c of chunk) enriched.set(c.id, res.get(c.companyName) ?? null);
			}
		} catch (e) {
			return { ok: false, error: `Prospeo bulk failed: ${e instanceof Error ? e.message : String(e)}` };
		}
	}
	for (const item of items) {
		try {
			let verdict: "pass" | "fail" = "fail";
			let note = "";
			if (stageKey === "headcount") {
				if (prospeoConfigured()) {
					const co = enriched.get(item.id) ?? null;
					await cacheProspeo(item.id, co);
					const n = co?.employeeCount ?? rangeMidpoint(co?.employeeRange ?? null);
					// null = not in Prospeo → almost certainly <15 employees → honest fail
					verdict = n !== null && n >= 15 && n <= 250 ? "pass" : "fail";
					note = n !== null ? `${co?.employeeCount ?? `${co?.employeeRange} range`} → ~${n} employees (Prospeo)` : "not in Prospeo — likely under 15 employees";
				} else {
					const n = await apolloHeadcount(item.companyName);
					verdict = n !== null && n >= 15 && n <= 250 ? "pass" : "fail";
					note = n !== null ? `${n} employees (Apollo)` : "not in Apollo — likely under 15 employees";
				}
			} else if (stageKey === "revenue_band") {
				// prefer the payload cached by the headcount run (free); enrich only if absent
				const cached = ((item.rawData as Record<string, unknown> | null)?.prospeo ?? null) as
					| { revenueMin?: number | null; revenueMax?: number | null }
					| null;
				const co =
					cached && (cached.revenueMin !== null || cached.revenueMax !== null)
						? (cached as { revenueMin: number | null; revenueMax: number | null })
						: enriched.get(item.id) ?? null;
				if (!co || co.revenueMin === null || co.revenueMax === null) throw new Error("no revenue data (Prospeo)");
				verdict = co.revenueMax >= 10 * M && co.revenueMin <= 70 * M ? "pass" : "fail";
				note = `$${Math.round(co.revenueMin / M)}–$${Math.round(co.revenueMax / M)}M (Prospeo)`;
			} else if (stageKey === "tech_team") {
				const hits = await apolloTechTitleHits(item.companyName);
				verdict = hits !== null && hits > 2 ? "fail" : "pass";
				note = hits !== null ? `${hits} tech-title hits (Apollo)` : "no tech titles found (Apollo)";
			} else if (stageKey === "ai_signal") {
				const raw = (item.rawData ?? {}) as Record<string, unknown>;
				const prospeo = (raw.prospeo ?? null) as { companyId?: string | null; domain?: string | null } | null;
				const refs = {
					companyId: prospeo?.companyId ?? null,
					domain: prospeo?.domain ?? null,
					name: item.companyName,
				};
				let roster = (raw.roster ?? null) as ProspeoRoster | null;
				if (!roster) {
					roster = await prospeoCompanyRoster(refs);
					await cacheRoster(item.id, roster);
				}
				const matches = scoreRoster(roster.people);

				const siteEvidence: string[] = [];
				const vendorHints: string[] = [];
				let siteAttempted = false;
				if (refs.domain) {
					siteAttempted = true;
					const base = `https://${refs.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`;
					const home = await fetchPage(base);
					if (home) {
						const hs = scanSite(home, `${base}/`, item.companyName);
						siteEvidence.push(...hs.evidence);
						vendorHints.push(...hs.vendorHints);
						const links = internalLinks(home);
						const pages = [...new Set([...links.slice(0, 3), links.find((p) => /privacy/i.test(p)) ?? "/privacy"])];
						for (const path of pages) {
							const page = await fetchPage(`${base}${path}`);
							if (!page) continue;
							const s = scanSite(page, `${base}${path}`, item.companyName);
							siteEvidence.push(...s.evidence);
							vendorHints.push(...s.vendorHints);
						}
					}
				}
				const t = scoreAiSignal({
					employeeMatches: matches,
					siteEvidence,
					vendorHints,
					rosterTotal: roster.total,
					rosterPeople: roster.people.length,
					siteAttempted,
				});
				verdict = t.verdict;
				note = t.note;
			} else {
				return { ok: false, error: `No api driver for stage ${stageKey}` };
			}
			await db.insert(funnelStageResults).values({ itemId: item.id, stage: stageKey, verdict, note, method: "api" });
			okCount++;
			await applyVerdictConsequences(item.id, info.stages);
		} catch (e) {
			errors++;
			if (!firstError) firstError = e instanceof Error ? e.message : String(e);
		}
	}
	return { ok: true, results: okCount, errors, ...(firstError ? { firstError: firstError.slice(0, 200) } : {}) };
}
