import { query, action, redirect } from "@solidjs/router";
import { db } from "~/db";
import { brainFacts, brainRequests, docs, newsletterEvents, shortLinks } from "~/db/schema";
import { getAuthedClient } from "~/lib/session";
import { eq, desc, sql } from "drizzle-orm";
import { factHash } from "~/lib/brain/core";
import { seedNewsletterAppendix } from "~/lib/docs";

async function requireAdmin() {
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
}

export const getDocsQuery = query(async () => {
	"use server";
	await requireAdmin();
	return db.select().from(docs).orderBy(desc(docs.updatedAt)).limit(100);
}, "admin-docs");

export const getDocQuery = query(async (id: string) => {
	"use server";
	await requireAdmin();
	const [row] = await db.select().from(docs).where(eq(docs.id, id));
	if (!row) throw redirect("/admin/docs");
	return row;
}, "admin-doc");

export type DocStats =
	| {
			kind: "newsletter";
			opens: number;
			clicks: number;
			requests: number;
			perPerson: { recipient: string | null; opens: number; clicks: number }[];
	  }
	| { kind: "post"; links: { slug: string; clicks: number }[] };

// Per-doc reality checks for the editor: opens + per-person clicks + brain
// requests for newsletters, linked-link clicks for posts. Per-person click
// rows live in newsletter_events (email only); aggregate per-link totals stay
// on short_links.clicks (links tab keeps reading those).
export const getDocStatsQuery = query(async (id: string): Promise<DocStats | null> => {
	"use server";
	await requireAdmin();
	const [doc] = await db.select({ id: docs.id, kind: docs.kind, opens: docs.opens }).from(docs).where(eq(docs.id, id));
	if (!doc) return null;
	if (doc.kind !== "newsletter") {
		const links = await db
			.select({ slug: shortLinks.slug, clicks: shortLinks.clicks })
			.from(shortLinks)
			.where(eq(shortLinks.docId, id))
			.orderBy(desc(shortLinks.clicks));
		return { kind: "post", links };
	}
	const num = sql<number>`count(*)`.mapWith(Number);
	const [[{ n: clicks }], [{ n: requests }], perPerson] = await Promise.all([
		db
			.select({ n: num })
			.from(newsletterEvents)
			.where(sql`${newsletterEvents.docId} = ${id} and ${newsletterEvents.type} = 'click'`),
		db.select({ n: num }).from(brainRequests).where(eq(brainRequests.sourceDocId, id)),
		db
			.select({
				recipient: newsletterEvents.recipient,
				opens: sql<number>`count(*) filter (where ${newsletterEvents.type} = 'open')`.mapWith(Number),
				clicks: sql<number>`count(*) filter (where ${newsletterEvents.type} = 'click')`.mapWith(Number),
			})
			.from(newsletterEvents)
			.where(eq(newsletterEvents.docId, id))
			.groupBy(newsletterEvents.recipient)
			// most recently active person first — the row you came to look for
			.orderBy(desc(sql`max(${newsletterEvents.createdAt})`))
			.limit(25),
	]);
	return { kind: "newsletter", opens: doc.opens, clicks, requests, perPerson };
}, "doc-stats");

export const createDocAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const title = String(formData.get("title") || "").trim() || "Untitled";
	const kindRaw = String(formData.get("kind") || "");
	const kind = kindRaw === "post" || kindRaw === "newsletter" ? kindRaw : null;
	const genre = String(formData.get("genre") || "").trim().toLowerCase() || null;
	const [row] = await db
		.insert(docs)
		.values({ title, kind, ...(genre ? { genre } : {}) })
		.returning();
	if (kind === "newsletter") await seedNewsletterAppendix(row.id);
	const base = kind === "post" ? "/admin/posts" : kind === "newsletter" ? "/admin/newsletters" : "/admin/docs";
	throw redirect(`${base}/${row.id}`);
}, "createDoc");

// Per-issue reality checks for the newsletters list: short-link clicks (per
// doc_id) and brain requests traced to the issue (ref= carried by the CTA's
// /l/ target). opens rides on the docs row (seal pixel).
export const getIssueStatsQuery = query(async () => {
	"use server";
	await requireAdmin();
	const [links, requests] = await Promise.all([
		db.select({ docId: shortLinks.docId, clicks: shortLinks.clicks }).from(shortLinks),
		db.select({ docId: brainRequests.sourceDocId }).from(brainRequests),
	]);
	const clicksByDoc: Record<string, number> = {};
	for (const l of links) if (l.docId) clicksByDoc[l.docId] = (clicksByDoc[l.docId] ?? 0) + l.clicks;
	const requestsByDoc: Record<string, number> = {};
	for (const r of requests) if (r.docId) requestsByDoc[r.docId] = (requestsByDoc[r.docId] ?? 0) + 1;
	return { clicksByDoc, requestsByDoc };
}, "issue-stats");

// "Add learning" next to a sent issue's stats — a tagged voice lesson the
// drafting agents must fetch (topic=subject / topic=cta) before writing.
export const addIssueLearningAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const fact = String(formData.get("fact") || "").trim();
	if (!fact) return { error: "Write the lesson first." };
	const topicRaw = String(formData.get("topic") || "");
	const topic = topicRaw === "subject" || topicRaw === "cta" ? topicRaw : null;
	await db
		.insert(brainFacts)
		.values({
			entitySlug: "voice",
			kind: "lesson",
			fact,
			factHash: factHash(fact),
			topic,
			surface: "newsletter",
			sourceTable: "manual",
			confidence: 0.8,
		})
		.onConflictDoNothing({ target: [brainFacts.entitySlug, brainFacts.factHash] });
	return { ok: true };
}, "add-issue-learning");
