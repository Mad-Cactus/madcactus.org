// "Run stage" — batch-run an api-method stage (headcount, tech_team) through
// the Apollo driver for every queued item. Session or mc_ key guarded.
// POST /api/funnels/runs/:id/run-stage { stage } → { results: n, errors: m }
import type { APIEvent } from "@solidjs/start/server";
import { db } from "~/db";
import { funnelStageResults } from "~/db/schema";
import { funnelAuthed, getQueue, getRunStages, applyVerdictConsequences } from "~/lib/funnels";
import { apolloConfigured, apolloHeadcount, apolloTechTitleHits } from "~/lib/enrich-apollo";

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const POST = async (event: APIEvent) => {
	if (!(await funnelAuthed(event.request))) return json({ error: "Unauthorized" }, 401);
	if (!apolloConfigured()) return json({ error: "Apollo driver unconfigured — set APOLLO_API_KEY" }, 400);
	const body = (await event.request.json().catch(() => ({}))) as { stage?: string; limit?: number };
	const info = await getRunStages(event.params.id);
	const stage = info?.stages.find((s) => s.key === body.stage);
	if (!info || !stage) return json({ error: "Run not found or unknown stage" }, 404);
	if (stage.method !== "api") return json({ error: `Stage ${stage.key} is not an api stage` }, 400);

	const queue = await getQueue(event.params.id, stage.key);
	if (!queue) return json({ error: "Run not found" }, 404);
	// ponytail: Apollo free tier is ~50 credits/day — slice the queue per click so
	// one press never burns a day's credits or times out the HTTP request.
	const items = queue.slice(0, Math.min(Math.max(Math.trunc(body.limit ?? 50), 1), 500));

	let ok = 0;
	let errors = 0;
	let firstError = "";
	for (const item of items) {
		try {
			if (stage.key === "headcount") {
				const n = await apolloHeadcount(item.companyName);
				// null = not in Apollo at all → a for-hire company absent from a 200M-company
				// DB is almost certainly <15 employees → honest fail, clears the queue.
				await db.insert(funnelStageResults).values({
					itemId: item.id,
					stage: stage.key,
					verdict: n !== null && n >= 15 && n <= 250 ? "pass" : "fail",
					note: n !== null ? `${n} employees (Apollo)` : "not in Apollo — likely under 15 employees",
					method: "api",
				});
			} else if (stage.key === "tech_team") {
				const hits = await apolloTechTitleHits(item.companyName);
				// null = no people data at all → absence of tech-staff evidence supports the gate
				await db.insert(funnelStageResults).values({
					itemId: item.id,
					stage: stage.key,
					verdict: hits !== null && hits > 2 ? "fail" : "pass",
					note: hits !== null ? `${hits} tech-title hits (Apollo)` : "no tech titles found (Apollo)",
					method: "api",
				});
			} else {
				return json({ error: `No api driver for stage ${stage.key}` }, 400);
			}
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
