// Funnels shared logic: the Freight ICP stage list (from ICP.md), lazy seed,
// and the promote/un-approve moves shared by the API routes.
import { and, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import { campaigns, entityLinks } from "~/db/schema";
import { checkApiKey } from "~/lib/api-key";
import { getAuthedClient } from "~/lib/session";
import {
	funnelItems,
	funnelRuns,
	funnelStageResults,
	funnels,
	outreachProspects,
	type FunnelStage,
} from "~/db/schema";

// Ordered gates from ICP.md — a later funnel (law, gov) is another row in
// `funnels` with its own stages; nothing here is freight-specific.
export const FREIGHT_STAGES: FunnelStage[] = [
	{ key: "hq_state", label: "Indiana HQ", gate: "Address/city is in Indiana, not a name token", method: "source" },
	{ key: "industry_type", label: "Industry", gate: "Freight brokerage / 3PL / knowledge-heavy carrier", method: "source" },
	{ key: "headcount", label: "Headcount", gate: "15-250 employees", method: "api" },
	{ key: "revenue_band", label: "Revenue", gate: "$10-70M estimate; rev/employee $150-500k sanity", method: "api" },
	{ key: "tech_team", label: "Tech team", gate: "≤2 title hits for CTO/VP Eng/IT Director/engineer/developer", method: "api" },
	{ key: "owner_led", label: "Owner-led", gate: "Founder/CEO still running it, not a PE roll-up", method: "agent" },
	{ key: "ai_signal", label: "AI signal", gate: "≥1 employee self-labels AI (Prospeo roster); site evidence corroborates only; vendor-hint recorded separately", method: "api" },
];

/** Funnels API accepts an admin session (UI) or an mc_ API key (scripts/agents). */
export async function funnelAuthed(request: Request) {
	return (await checkApiKey(request)) || (await getAuthedClient()) !== null;
}

export type ImportRow = {
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

/** Insert items into an open run: dedup on (runId, company), skip already-promoted
 *  companies, auto-write hq_state / industry_type verdicts from row evidence. */
export async function importRunItems(
	runId: string,
	rows: ImportRow[],
): Promise<{ imported: number; duplicated: number; skippedPromoted: number }> {
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
				runId,
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
	return { imported, duplicated, skippedPromoted };
}

/** Insert the Freight ICP funnel if the table is empty. Called on list reads —
 *  no seed migration, so drizzle stays the only writer of SQL. */
export async function ensureFreightFunnel() {
	const existing = await db.select().from(funnels).where(eq(funnels.name, "Freight ICP")).limit(1);
	if (existing.length === 0) {
		await db.insert(funnels).values({
			name: "Freight ICP",
			description: "Owner-led Indiana freight brokers/3PLs, $10-70M, no tech team (see ICP.md)",
			stages: FREIGHT_STAGES,
		}).onConflictDoNothing();
		return;
	}
	// stage definitions evolve (method changes) — keep the seeded row in sync
	if (JSON.stringify(existing[0].stages) !== JSON.stringify(FREIGHT_STAGES)) {
		await db.update(funnels).set({ stages: FREIGHT_STAGES }).where(eq(funnels.id, existing[0].id));
	}
}

export async function getFunnel(funnelId: string) {
	const [f] = await db.select().from(funnels).where(eq(funnels.id, funnelId)).limit(1);
	return f ?? null;
}

/** Stage keys of the funnel a run belongs to. */
export async function getRunStages(runId: string): Promise<{ run: typeof funnelRuns.$inferSelect; stages: FunnelStage[] } | null> {
	const [row] = await db
		.select({ run: funnelRuns, stages: funnels.stages })
		.from(funnelRuns)
		.innerJoin(funnels, eq(funnelRuns.funnelId, funnels.id))
		.where(eq(funnelRuns.id, runId))
		.limit(1);
	if (!row) return null;
	return { run: row.run, stages: row.stages };
}

/**
 * Items queued at `stage`: all earlier stages pass, this stage has no result.
 * Fail at any stage removes the item from all later queues (and its own).
 */
export async function getQueue(runId: string, stageKey: string) {
	const info = await getRunStages(runId);
	if (!info) return null;
	const idx = info.stages.findIndex((s) => s.key === stageKey);
	if (idx === -1) return null;
	const earlier = info.stages.slice(0, idx).map((s) => s.key);
	const rows = await db
		.select()
		.from(funnelItems)
		.where(
			and(
				eq(funnelItems.runId, runId),
				// no result at this stage yet
				sql`not exists (select 1 from ${funnelStageResults} r where r.item_id = ${funnelItems.id} and r.stage = ${stageKey})`,
				// every earlier stage has a passing result
				...earlier.map(
					(k) =>
						sql`exists (select 1 from ${funnelStageResults} r where r.item_id = ${funnelItems.id} and r.stage = ${k} and r.verdict = 'pass')`,
				),
			),
		)
		.orderBy(
			// IBJ rank first (highest signal), then oldest-founded FMCSA companies
			// (established = far more likely to be in Apollo), then alphabetical.
			sql`(${funnelItems.rawData}->>'rank')::int asc nulls last`,
			sql`(${funnelItems.rawData}->>'founded') asc nulls last`,
			funnelItems.companyName,
		);
	return rows;
}

/** Per-stage counts for a run: passed / failed / awaiting per stage. */
export async function getSummary(runId: string, stages: FunnelStage[]) {
	const items = await db.select({ id: funnelItems.id }).from(funnelItems).where(eq(funnelItems.runId, runId));
	const results = items.length
		? await db
				.select({ itemId: funnelStageResults.itemId, stage: funnelStageResults.stage, verdict: funnelStageResults.verdict })
				.from(funnelStageResults)
				.where(inArray(funnelStageResults.itemId, items.map((i) => i.id)))
		: [];
	const byStage = stages.map((s) => {
		const rs = results.filter((r) => r.stage === s.key);
		return {
			stage: s.key,
			label: s.label,
			passed: rs.filter((r) => r.verdict === "pass").length,
			failed: rs.filter((r) => r.verdict === "fail").length,
			awaiting: items.length - rs.length,
		};
	});
	return { total: items.length, byStage };
}

/**
 * After a verdict lands: 6/6 passes → promote (idempotent — a second 6/6
 * updates the existing prospect); any fail on a promoted item → icpApproved
 * stays false until a pass re-lands everywhere.
 */
export async function applyVerdictConsequences(itemId: string, stages: FunnelStage[]) {
	const [item] = await db.select().from(funnelItems).where(eq(funnelItems.id, itemId)).limit(1);
	if (!item) return;
	const results = await db
		.select({ stage: funnelStageResults.stage, verdict: funnelStageResults.verdict, note: funnelStageResults.note })
		.from(funnelStageResults)
		.where(eq(funnelStageResults.itemId, itemId));
	const allPass = stages.every((s) => results.some((r) => r.stage === s.key && r.verdict === "pass"));
	const anyFail = results.some((r) => r.verdict === "fail");

	// ai_signal note tier → aiInterest (tier1=high, tier2=some) — only on a
	// pass; a tier2 FAIL note (site-only rescue evidence) must never set it.
	const aiRow = results.find((r) => r.stage === "ai_signal");
	const aiInterest = aiRow?.verdict === "pass" && aiRow.note?.startsWith("tier1")
		? "high"
		: aiRow?.verdict === "pass" && aiRow.note?.startsWith("tier2")
			? "some"
			: null;

	if (allPass && !anyFail) {
		const raw = (item.rawData ?? {}) as Record<string, unknown>;
		const resultRows = await db
			.select({ stage: funnelStageResults.stage, note: funnelStageResults.note })
			.from(funnelStageResults)
			.where(eq(funnelStageResults.itemId, itemId));
		const noteFor = (k: string) => resultRows.find((r) => r.stage === k)?.note ?? "unknown";
	// attach to the Freight & logistics campaign when one exists (campaignId is
	// nullable — a missing campaign must not block promotion)
	const [campaign] = await db
		.select({ id: campaigns.id })
		.from(campaigns)
		.where(ilike(campaigns.name, "%freight%"))
		.limit(1);
		if (item.prospectId) {
			await db
				.update(outreachProspects)
				.set({
					region: item.state ?? "unknown",
					revenueBand: noteFor("revenue_band"),
					techTeam: noteFor("tech_team"),
					...(aiInterest ? { aiInterest } : {}),
					icpApproved: true,
				})
				.where(eq(outreachProspects.id, item.prospectId));
		} else {
			const [prospect] = await db
				.insert(outreachProspects)
				.values({
					company: item.companyName,
					stage: "candidate",
					region: item.state ?? "unknown",
					revenueBand: noteFor("revenue_band"),
					techTeam: noteFor("tech_team"),
					...(aiInterest ? { aiInterest } : {}),
					icpApproved: true,
					sourceNote: `funnel-run ${new Date().toISOString().slice(0, 10)}`,
					campaignId: campaign?.id ?? null,
					notes: typeof raw.address === "string" ? raw.address : null,
				})
				.returning({ id: outreachProspects.id });
			await db
				.update(funnelItems)
				.set({ prospectId: prospect.id, promotedAt: new Date() })
				.where(eq(funnelItems.id, itemId));
			// registry link: run → promoted prospect (board card shows where it came from)
			await db
				.insert(entityLinks)
				.values({ fromKind: "funnel-run", fromId: item.runId, toKind: "prospect", toId: prospect.id, linkType: "promoted", createdBy: "agent" })
				.onConflictDoNothing();
		}
		return;
	}

	// not 6/6 (or a fail landed): if promoted, drop approval — the existing
	// invite gate picks this up; the prospect row itself survives.
	if (item.prospectId) {
		await db.update(outreachProspects).set({ icpApproved: allPass && !anyFail }).where(eq(outreachProspects.id, item.prospectId));
	}
}
