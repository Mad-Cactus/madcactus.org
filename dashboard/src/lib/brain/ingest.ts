// Brain ingest — deterministic cycle phases (no LLM):
//   sync_entities: one brain_page per company/project (CRM-coupled)
//   detect_loops:  unanswered-inbound detection + auto-close on reply
//   backfill_timeline: recent email threads → entity page timelines
//   recompute_weight: salience per page
// These run every cycle; the LLM phases (distill.ts) run after them.
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
	brainFacts,
	brainOpenLoops,
	brainPages,
	brainTimeline,
	companies,
	projects,
} from "~/db/schema";
import { computeEmotionalWeight, loopDedupKey, planLoopForThread, slugify, type ThreadSummary } from "./core";

export async function syncEntities(): Promise<{ created: number }> {
	let created = 0;
	for (const c of await db.select({ id: companies.id, name: companies.name, aliases: companies.aliases }).from(companies)) {
		const slug = slugify(c.name);
		const existing = await db.select({ id: brainPages.id }).from(brainPages).where(eq(brainPages.slug, slug)).limit(1);
		if (existing.length === 0) {
			await db.insert(brainPages).values({
				slug,
				type: "entity",
				entityKind: "company",
				companyId: c.id,
				title: c.name,
			});
			created++;
		} else if (c.id) {
			await db.update(brainPages).set({ companyId: c.id }).where(eq(brainPages.slug, slug));
		}
	}
	for (const p of await db.select({ id: projects.id, name: projects.name }).from(projects)) {
		const slug = slugify(`project ${p.name}`);
		const existing = await db.select({ id: brainPages.id }).from(brainPages).where(eq(brainPages.slug, slug)).limit(1);
		if (existing.length === 0) {
			await db.insert(brainPages).values({
				slug,
				type: "entity",
				entityKind: "project",
				title: p.name,
			});
			created++;
		}
	}
	return { created };
}

/** Deterministic unanswered-inbound detector over email threads. */
export async function detectLoops(opts: { staleDays?: number } = {}): Promise<{ opened: number; closed: number }> {
	const rows = await db.execute<{
		id: string;
		subject: string;
		from_email: string | null;
		company_id: string | null;
		last_message_at: Date;
		last_is_sent: boolean;
		has_open_loop: boolean;
	}>(sql`
		SELECT t.id, t.subject, t.from_email,
			(SELECT ccm.company_id FROM client_members cm
			 JOIN client_company_members ccm ON ccm.member_id = cm.id
			 WHERE cm.email = t.from_email LIMIT 1) AS company_id,
			t.last_message_at,
			COALESCE((SELECT m.is_sent FROM email_messages m WHERE m.thread_id = t.id ORDER BY m.date DESC LIMIT 1), false) AS last_is_sent,
			EXISTS (SELECT 1 FROM brain_open_loops l WHERE l.thread_id = t.id AND l.status = 'open') AS has_open_loop
		FROM email_threads t
		ORDER BY t.last_message_at DESC
		LIMIT 500
	`);

	let opened = 0;
	let closed = 0;
	for (const r of rows) {
		const summary: ThreadSummary = {
			id: r.id,
			subject: r.subject ?? "(no subject)",
			fromEmail: r.from_email,
			companyId: r.company_id,
			lastMessageAt: new Date(r.last_message_at),
			lastMessageIsSent: r.last_is_sent,
			hasOpenLoop: r.has_open_loop,
		};
		const plan = planLoopForThread(summary, new Date(), opts.staleDays ?? 3);
		if (plan.action === "open") {
			await db
				.insert(brainOpenLoops)
				.values({
					dedupKey: plan.dedupKey,
					loopType: plan.loopType,
					companyId: plan.companyId,
					counterpartyEmail: plan.counterpartyEmail,
					summary: plan.summary,
					threadId: plan.threadId,
					detector: "deterministic_thread",
				})
				.onConflictDoNothing({ target: brainOpenLoops.dedupKey });
			opened++;
		} else if (plan.action === "close") {
			await db
				.update(brainOpenLoops)
				.set({ status: "done", closedAt: new Date(), closedBy: "deterministic_thread" })
				.where(and(eq(brainOpenLoops.dedupKey, plan.dedupKey), eq(brainOpenLoops.status, "open")));
			closed++;
		}
	}
	return { opened, closed };
}

/** Timeline entries on company pages from recent thread activity (deduped). */
export async function backfillTimeline(days = 30): Promise<{ inserted: number }> {
	const since = new Date(Date.now() - days * 86_400_000).toISOString();
	const rows = await db.execute<{ company_id: string; company_name: string; thread_id: string; subject: string; last_message_at: Date }>(sql`
		SELECT c.id AS company_id, c.name AS company_name, t.id AS thread_id, t.subject, t.last_message_at
		FROM email_threads t
		JOIN client_members cm ON cm.email = t.from_email
		JOIN client_company_members ccm ON ccm.member_id = cm.id
		JOIN companies c ON c.id = ccm.company_id
		WHERE t.last_message_at >= ${since}
		ORDER BY t.last_message_at DESC
		LIMIT 300
	`);
	let inserted = 0;
	for (const r of rows) {
		const slug = slugify(r.company_name);
		const [page] = await db.select({ id: brainPages.id }).from(brainPages).where(eq(brainPages.slug, slug)).limit(1);
		if (!page) continue;
		const dup = await db
			.select({ id: brainTimeline.id })
			.from(brainTimeline)
			.where(
				and(
					eq(brainTimeline.pageId, page.id),
					eq(brainTimeline.sourceTable, "email_threads"),
					eq(brainTimeline.sourceId, r.thread_id),
				),
			)
			.limit(1);
		if (dup.length > 0) continue;
		await db.insert(brainTimeline).values({
			pageId: page.id,
			date: new Date(r.last_message_at).toISOString().slice(0, 10),
			source: "email",
			summary: r.subject ?? "(no subject)",
			sourceTable: "email_threads",
			sourceId: r.thread_id,
		});
		inserted++;
	}
	return { inserted };
}

/** Salience per entity page (recency + loops + notability). */
export async function recomputeWeight(): Promise<{ updated: number }> {
	const pages = await db
		.select({ id: brainPages.id, updatedAt: brainPages.updatedAt })
		.from(brainPages)
		.where(isNull(brainPages.deletedAt));
	let updated = 0;
	for (const p of pages) {
		const [loopCount] = await db
			.select({ n: sql<number>`count(*)::int` })
			.from(brainOpenLoops)
			.where(and(eq(brainOpenLoops.pageSlug, sql`(select slug from brain_pages where id = ${p.id})`), eq(brainOpenLoops.status, "open")));
		const notability = await db
			.select({ notability: brainFacts.notability, n: sql<number>`count(*)::int` })
			.from(brainFacts)
			.where(and(eq(brainFacts.entitySlug, sql`(select slug from brain_pages where id = ${p.id})`), isNull(brainFacts.expiredAt)))
			.groupBy(brainFacts.notability);
		const counts = { high: 0, medium: 0, low: 0 };
		for (const row of notability) counts[row.notability] = row.n;
		const weight = computeEmotionalWeight({
			updatedAt: p.updatedAt,
			openLoops: loopCount.n,
			factNotability: counts,
		});
		await db.update(brainPages).set({ emotionalWeight: weight }).where(eq(brainPages.id, p.id));
		updated++;
	}
	return { updated };
}
