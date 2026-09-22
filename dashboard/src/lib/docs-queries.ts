import { query, action, redirect } from "@solidjs/router";
import { db } from "~/db";
import { brainFacts, brainRequests, docs, shortLinks } from "~/db/schema";
import { getAuthedClient } from "~/lib/session";
import { eq, desc } from "drizzle-orm";
import { factHash } from "~/lib/brain/core";
import { BRAIN_CTA_APPENDIX } from "~/lib/publish-core";

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

export const createDocAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const title = String(formData.get("title") || "").trim() || "Untitled";
	const kindRaw = String(formData.get("kind") || "");
	const kind = kindRaw === "post" || kindRaw === "newsletter" ? kindRaw : null;
	const genre = String(formData.get("genre") || "").trim().toLowerCase() || null;
	const [row] = await db
		.insert(docs)
		.values({
			title,
			kind,
			...(genre ? { genre } : {}),
			// the one funnel: new issues carry the /brain CTA in both channels
			...(kind === "newsletter" ? { emailAppendix: BRAIN_CTA_APPENDIX, webAppendix: BRAIN_CTA_APPENDIX } : {}),
		})
		.returning();
	const base = kind === "post" ? "/admin/posts" : kind === "newsletter" ? "/admin/newsletters" : "/admin/docs";
	throw redirect(`${base}/${row.id}`);
}, "createDoc");

// Per-issue reality checks for the newsletters list: short-link clicks (per
// doc_id) and brain requests traced to the issue (utm ?ref= on the /brain
// link). opens/clicks columns ride on the docs rows themselves.
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
