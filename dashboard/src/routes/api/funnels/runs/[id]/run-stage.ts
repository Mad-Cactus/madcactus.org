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
	for (const item of items) {
		try {
			if (stage.key === "headcount") {
				const n = await apolloHeadcount(item.companyName);
				if (n === null) throw new Error("no Apollo match");
				await db.insert(funnelStageResults).values({
					itemId: item.id,
					stage: stage.key,
					verdict: n >= 15 && n <= 250 ? "pass" : "fail",
					note: `${n} employees (Apollo)`,
					method: "api",
				});
			} else if (stage.key === "tech_team") {
				const hits = await apolloTechTitleHits(item.companyName);
				if (hits === null) throw new Error("no Apollo data");
				await db.insert(funnelStageResults).values({
					itemId: item.id,
					stage: stage.key,
					verdict: hits <= 2 ? "pass" : "fail",
					note: `${hits} tech-title hits (Apollo)`,
					method: "api",
				});
			} else {
				return json({ error: `No api driver for stage ${stage.key}` }, 400);
			}
			ok++;
			await applyVerdictConsequences(item.id, info.stages);
		} catch {
			errors++;
		}
	}
	return json({ ok: true, results: ok, errors });
};
