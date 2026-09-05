// Brain admin — queries + actions for the /admin/brain page.
import { query, action } from "@solidjs/router";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "~/db";
import {
	brainFacts,
	brainOpenLoops,
	brainPages,
	brainTakes,
} from "~/db/schema";
import { getAuthedClient } from "~/lib/session";

async function requireAdmin() {
	const supabase = await getAuthedClient();
	if (!supabase) throw new Error("Unauthorized");
	return supabase;
}

export const getBrainStatsQuery = query(async () => {
	"use server";
	await requireAdmin();
	const [pages] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(brainPages)
		.where(sql`deleted_at IS NULL`);
	const [facts] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(brainFacts)
		.where(sql`expired_at IS NULL`);
	const [takes] = await db.select({ n: sql<number>`count(*)::int` }).from(brainTakes);
	const [loops] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(brainOpenLoops)
		.where(eq(brainOpenLoops.status, "open"));
	const [cursor] = await db.execute<{ at: string | null }>(sql`
		SELECT value->>'at' AS at FROM brain_state WHERE key = 'last_cycle_at'
	`);
	return {
		pages: pages.n,
		facts: facts.n,
		takes: takes.n,
		openLoops: loops.n,
		lastCycleAt: (cursor as unknown as { at: string | null }[] | undefined)?.[0]?.at ?? (cursor as unknown as { at: string | null })?.at ?? null,
	};
}, "brain-stats");

export const getOpenLoopsQuery = query(async () => {
	"use server";
	await requireAdmin();
	return db
		.select()
		.from(brainOpenLoops)
		.where(eq(brainOpenLoops.status, "open"))
		.orderBy(desc(brainOpenLoops.lastActivityAt))
		.limit(50);
}, "brain-loops");

export const getRecentFactsQuery = query(async () => {
	"use server";
	await requireAdmin();
	return db
		.select({
			id: brainFacts.id,
			entitySlug: brainFacts.entitySlug,
			fact: brainFacts.fact,
			kind: brainFacts.kind,
			surface: brainFacts.surface,
			sourceTable: brainFacts.sourceTable,
			createdAt: brainFacts.createdAt,
		})
		.from(brainFacts)
		.where(sql`expired_at IS NULL`)
		.orderBy(desc(brainFacts.createdAt))
		.limit(40);
}, "brain-facts");

export const getBrainPagesQuery = query(async () => {
	"use server";
	await requireAdmin();
	return db
		.select({
			id: brainPages.id,
			slug: brainPages.slug,
			title: brainPages.title,
			type: brainPages.type,
			entityKind: brainPages.entityKind,
			weight: brainPages.emotionalWeight,
			updatedAt: brainPages.updatedAt,
		})
		.from(brainPages)
		.where(sql`deleted_at IS NULL`)
		.orderBy(desc(brainPages.emotionalWeight))
		.limit(60);
}, "brain-pages");

/** Fire the full brain cycle server-side (session-authed admin). */
export const runBrainCycleAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const { runCycle } = await import("~/lib/brain/distill");
	const result = await runCycle({
		reprocessTranscripts: formData.get("reprocessTranscripts") === "true",
		slack: formData.get("slack") !== "false",
	});
	return { ok: true, cycle: result };
}, "brain-run-cycle");

/** Close an open loop manually (false positive / handled elsewhere). */
export const closeLoopAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const { brainOpenLoops } = await import("~/db/schema");
	await db
		.update(brainOpenLoops)
		.set({ status: "done", closedAt: new Date(), closedBy: "manual" })
		.where(eq(brainOpenLoops.id, String(formData.get("loopId"))));
	return { ok: true };
}, "brain-close-loop");
