// "Run stage" — batch-run an api-method stage through its driver for queued
// items. Drivers: Prospeo (headcount, revenue_band — 0 credits on miss),
// Apollo (tech_team). Session or mc_ key guarded.
// POST /api/funnels/runs/:id/run-stage { stage, limit? } → { results, errors, firstError? }
import type { APIEvent } from "@solidjs/start/server";
import { db } from "~/db";
import { funnelStageResults } from "~/db/schema";
import { funnelAuthed, getQueue, getRunStages, applyVerdictConsequences } from "~/lib/funnels";
import { apolloConfigured, apolloHeadcount, apolloTechTitleHits } from "~/lib/enrich-apollo";
import { prospeoConfigured, prospeoEnrichCompany, rangeMidpoint } from "~/lib/enrich-prospeo";

const M = 1_000_000;

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const POST = async (event: APIEvent) => {
	if (!(await funnelAuthed(event.request))) return json({ error: "Unauthorized" }, 401);
	const body = (await event.request.json().catch(() => ({}))) as { stage?: string; limit?: number };
	const info = await getRunStages(event.params.id);
	const stage = info?.stages.find((s) => s.key === body.stage);
	if (!info || !stage) return json({ error: "Run not found or unknown stage" }, 404);
	if (stage.method !== "api") return json({ error: `Stage ${stage.key} is not an api stage` }, 400);
	if (stage.key === "tech_team" && !apolloConfigured())
		return json({ error: "Tech-team stage needs APOLLO_API_KEY" }, 400);
	if (stage.key !== "tech_team" && !prospeoConfigured())
		return json({ error: `${stage.key} stage needs PROSPEO_API_KEY` }, 400);

	const queue = await getQueue(event.params.id, stage.key);
	if (!queue) return json({ error: "Run not found" }, 404);
	// ponytail: enrichment credits are finite — slice the queue per click so one
	// press never burns a credit pack or times out the HTTP request.
	const items = queue.slice(0, Math.min(Math.max(Math.trunc(body.limit ?? 50), 1), 500));

	let ok = 0;
	let errors = 0;
	let firstError = "";
	for (const item of items) {
		try {
			let verdict: "pass" | "fail" = "fail";
			let note = "";
			if (stage.key === "headcount") {
				if (prospeoConfigured()) {
					const co = await prospeoEnrichCompany(item.companyName);
					const n = co?.employeeCount ?? rangeMidpoint(co?.employeeRange ?? null);
					// null = not in Prospeo → almost certainly <15 employees → honest fail
					verdict = n !== null && n >= 15 && n <= 250 ? "pass" : "fail";
					note = n !== null ? `${co?.employeeCount ?? `${co?.employeeRange} range`} → ~${n} employees (Prospeo)` : "not in Prospeo — likely under 15 employees";
				} else {
					const n = await apolloHeadcount(item.companyName);
					verdict = n !== null && n >= 15 && n <= 250 ? "pass" : "fail";
					note = n !== null ? `${n} employees (Apollo)` : "not in Apollo — likely under 15 employees";
				}
			} else if (stage.key === "revenue_band") {
				const co = await prospeoEnrichCompany(item.companyName);
				if (!co || co.revenueMin === null || co.revenueMax === null) throw new Error("no revenue data (Prospeo)");
				// pass when the range overlaps the $10-70M band
				verdict = co.revenueMax >= 10 * M && co.revenueMin <= 70 * M ? "pass" : "fail";
				note = `$${Math.round(co.revenueMin / M)}–$${Math.round(co.revenueMax / M)}M (Prospeo)`;
			} else if (stage.key === "tech_team") {
				const hits = await apolloTechTitleHits(item.companyName);
				// null = no people data → absence of tech-staff evidence supports the gate
				verdict = hits !== null && hits > 2 ? "fail" : "pass";
				note = hits !== null ? `${hits} tech-title hits (Apollo)` : "no tech titles found (Apollo)";
			} else {
				return json({ error: `No api driver for stage ${stage.key}` }, 400);
			}
			await db.insert(funnelStageResults).values({ itemId: item.id, stage: stage.key, verdict, note, method: "api" });
			ok++;
			await applyVerdictConsequences(item.id, info.stages);
		} catch (e) {
			errors++;
			// surface the first failure reason — silent error counts made this hard to debug
			if (!firstError) firstError = e instanceof Error ? e.message : String(e);
		}
	}
	return json({ ok: true, results: ok, errors, ...(firstError ? { firstError: firstError.slice(0, 200) } : {}) });
};
