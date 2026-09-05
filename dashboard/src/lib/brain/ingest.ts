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
	clientMembers,
	companies,
	outreachProspects,
	projects,
} from "~/db/schema";
import { computeEmotionalWeight, loopDedupKey, planLoopForThread, slugify, type ThreadSummary } from "./core";

/**
 * Person pages from every corpus that names humans: meeting transcript
 * speakers + email counterparties + portal members. Facts attach to these
 * slugs as the corpus grows (who said what, who prefers what).
 */
export async function syncPersons(): Promise<{ created: number }> {
	let created = 0;
	const seen = new Set<string>();
	// role addresses and separator-less local parts aren't people
	const ROLE = /^(noreply|no-reply|hello|hi|team|updates|update|info|support|admin|notifications|notify|mail|contact|careers)\d*$/i;
	const ensure = async (name: string) => {
		const clean = name.trim();
		if (!clean || clean.length > 60 || /^speaker \d+$/i.test(clean)) return;
		const slug = `person-${slugify(clean)}`;
		if (seen.has(slug)) return;
		seen.add(slug);
		const existing = await db.select({ id: brainPages.id }).from(brainPages).where(eq(brainPages.slug, slug)).limit(1);
		if (existing.length === 0) {
			await db.insert(brainPages).values({
				slug,
				type: "entity",
				entityKind: "person",
				title: clean,
			});
			created++;
		}
	};
	// meeting speakers (transcript_json blocks)
	const speakers = await db.execute<{ speaker: string }>(sql`
		SELECT DISTINCT t->>'speaker' AS speaker
		FROM documents, jsonb_array_elements(transcript_json::jsonb) AS t
		WHERE type = 'transcript' AND transcript_json IS NOT NULL
		LIMIT 500
	`);
	for (const r of speakers) await ensure(r.speaker ?? "");
	// email counterparties (inbound senders)
	const senders = await db.execute<{ from_email: string | null }>(sql`
		SELECT from_email FROM email_messages WHERE from_email IS NOT NULL
		GROUP BY from_email ORDER BY count(*) DESC LIMIT 200
	`);
	for (const r of senders) {
		const local = (r.from_email ?? "").split("@")[0] ?? "";
		if (ROLE.test(local) || !/[._-]/.test(local)) continue; // "cpfeifer" can't be split safely
		const name = local
			.replace(/[._-]+/g, " ")
			.replace(/\b\w/g, (c) => c.toUpperCase());
		// machine senders survive the ROLE filter as "No Reply <hash>" etc
		if (/reply/i.test(name) || /^usr\b/i.test(local) || /\b(in|the|and|for|of|a|an)\b/i.test(name)) continue;
		await ensure(name);
	}
	// portal members
	for (const m of await db.select({ name: clientMembers.name }).from(clientMembers)) {
		await ensure(m.name);
	}
	// slack members (real names only)
	const slack = await db.execute<{ real_name: string; name: string }>(sql`
		SELECT real_name, name FROM slack_users WHERE deleted = false AND is_bot = false LIMIT 500
	`);
	for (const r of slack) await ensure(r.real_name || r.name);
	return { created };
}

/**
 * Prospect pipeline → brain: one prospect page per outreach prospect
 * (stage/next-action in frontmatter) + a follow-up open loop when a
 * next_action_at is set. Won/lost prospects close their loop.
 */
export async function syncProspects(): Promise<{ created: number; loopsOpened: number; loopsClosed: number }> {
	let created = 0;
	let loopsOpened = 0;
	let loopsClosed = 0;
	const prospects = await db.select().from(outreachProspects);
	for (const p of prospects) {
		const slug = `prospect-${slugify(p.company)}`;
		const existing = await db.select({ id: brainPages.id }).from(brainPages).where(eq(brainPages.slug, slug)).limit(1);
		if (existing.length === 0) {
			await db.insert(brainPages).values({
				slug,
				type: "entity",
				entityKind: "prospect",
				title: p.company,
				frontmatter: { stage: p.stage, nextActionAt: p.nextActionAt, notes: p.notes },
			});
			created++;
		}
		// terminal stages in the outreach pipeline: won | shutdown
		const done = p.stage === "won" || p.stage === "shutdown";
		const dedupKey = `prospect_next_action:${p.id}`;
		if (p.nextActionAt && !done) {
			const res = await db
				.insert(brainOpenLoops)
				.values({
					dedupKey,
					loopType: "commitment_owed_by_me",
					companyId: null,
					counterpartySlug: slug,
					summary: `${p.stage} prospect ${p.company}: next action ${p.nextActionNote ?? "follow up"}`,
					pageSlug: slug,
					dueAt: p.nextActionAt,
					detector: "deterministic_thread",
					confidence: 1,
				})
				.onConflictDoNothing({ target: brainOpenLoops.dedupKey })
				.returning({ id: brainOpenLoops.id });
			loopsOpened += res.length;
		} else if (done) {
			const res = await db
				.update(brainOpenLoops)
				.set({ status: "done", closedAt: new Date(), closedBy: "syncProspects" })
				.where(and(eq(brainOpenLoops.dedupKey, dedupKey), eq(brainOpenLoops.status, "open")))
				.returning({ id: brainOpenLoops.id });
			loopsClosed += res.length;
		}
	}
	return { created, loopsOpened, loopsClosed };
}

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
	// the voice page: lessons from diffs accumulate here (entity_slug 'voice')
	const voiceExists = await db
		.select({ id: brainPages.id })
		.from(brainPages)
		.where(eq(brainPages.slug, "madcactus-voice"))
		.limit(1);
	if (voiceExists.length === 0) {
		await db.insert(brainPages).values({
			slug: "madcactus-voice",
			type: "entity",
			entityKind: "topic",
			title: "Mad Cactus Voice",
		});
		created++;
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
		has_my_reply: boolean;
		has_open_loop: boolean;
	}>(sql`
		SELECT t.id, t.subject, t.from_email,
			(SELECT ccm.company_id FROM client_members cm
			 JOIN client_company_members ccm ON ccm.member_id = cm.id
			 WHERE cm.email = t.from_email LIMIT 1) AS company_id,
			t.last_message_at,
			COALESCE((SELECT m.is_sent FROM email_messages m WHERE m.thread_id = t.id ORDER BY m.date DESC LIMIT 1), false) AS last_is_sent,
			EXISTS (SELECT 1 FROM email_messages m WHERE m.thread_id = t.id AND m.is_sent) AS has_my_reply,
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
			hasMyReply: r.has_my_reply,
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
