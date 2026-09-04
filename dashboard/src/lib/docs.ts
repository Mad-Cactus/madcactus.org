// Docs — CRDT markdown documents with full version history.
//
// Merge layer: a Loro doc holding one LoroText with the markdown. Human saves
// arrive as full markdown; we convert old→new into Loro deltas so a concurrent
// agent append merges instead of clobbering (char-level CRDT, same lib macro
// uses). The markdown column is the projection: search, export, share.
//
// History layer: every save appends a doc_versions row (author agent|human).
// Diffs compute on read — no pair tables. status='draft' means "has an agent
// write awaiting human review"; any human save (or Mark final) flips it back.
//
// ponytail: single-text Loro doc + diff-hunk deltas replaces macro's 2.8k-line
// @loro-mirror/core tree mirror — our docs are one text, not a nested Lexical
// tree on the server. If docs ever become multi-writer trees, vendor
// ~/GitHub/macro/packages/loro-mirror and store serialized editor state.
import { and, asc, desc, eq } from "drizzle-orm";
import { diffWordsWithSpace, createPatch } from "diff";
import { LoroDoc, type LoroText } from "loro-crdt";
import { randomBytes } from "crypto";
import { db } from "~/db";
import { docVersions, docs, type Doc, type DocVersion } from "~/db/schema";

// ── Diffing ────────────────────────────────────────────────────────

export type WordPart = { value: string; added?: boolean; removed?: boolean };

/** GitHub-style word-level parts (UI highlighting). */
export function wordDiff(oldStr: string, newStr: string): WordPart[] {
	return diffWordsWithSpace(oldStr, newStr);
}

/** Plain unified diff text between two versions. */
export function unifiedDiff(oldStr: string, newStr: string): string {
	return createPatch("content", oldStr, newStr, "before", "after");
}

// ── Version policy ─────────────────────────────────────────────────

const COALESCE_WINDOW_MS = 10 * 60_000;

/**
 * Consecutive saves by the same author within the window are one editing
 * session — update the tip version instead of appending, so history stays
 * at session granularity, not keystroke granularity.
 */
export function shouldCoalesceVersion(
	last: { author: string; createdAt: Date } | undefined,
	author: "agent" | "human",
	now = new Date(),
): boolean {
	return (
		!!last &&
		last.author === author &&
		now.getTime() - last.createdAt.getTime() < COALESCE_WINDOW_MS
	);
}

/** The unreviewed agent write: latest agent version newer than the latest human version. */
export function pickPendingAgentVersion<T extends { author: string; createdAt: Date }>(
	versions: T[],
): T | null {
	// versions ascending by createdAt (getDocVersions order)
	const humanAt = versions.reduce<number>(
		(m, v) => (v.author === "human" ? Math.max(m, v.createdAt.getTime()) : m),
		-Infinity,
	);
	for (let i = versions.length - 1; i >= 0; i--) {
		const v = versions[i];
		if (v.author === "agent" && v.createdAt.getTime() > humanAt) return v;
	}
	return null;
}

// ── Loro layer ─────────────────────────────────────────────────────

function loroFromSnapshot(snapshotB64: string | null | undefined): { doc: LoroDoc; text: LoroText } {
	const doc = new LoroDoc();
	if (snapshotB64) {
		try {
			doc.import(new Uint8Array(Buffer.from(snapshotB64, "base64")));
		} catch {
			// corrupt/absent snapshot — start fresh; markdown column stays truth
		}
	}
	const text = doc.getText("markdown");
	return { doc, text };
}

function snapshotB64(doc: LoroDoc): string {
	return Buffer.from(doc.export({ mode: "snapshot" })).toString("base64");
}

/** Apply full-markdown replacement as Loro ops (keeps CRDT history + merge base). */
function applyMarkdown(text: LoroText, next: string) {
	const current = text.toString();
	if (current === next) return;
	if (current.length > 0) text.delete(0, current.length);
	if (next.length > 0) text.insert(0, next);
}

// ── Queries ────────────────────────────────────────────────────────

export async function createDoc(
	title: string,
	markdown = "",
	opts: { status?: "draft" | "final"; author?: "agent" | "human"; chatUuid?: string } = {},
): Promise<Doc> {
	const { doc, text } = loroFromSnapshot(null);
	if (markdown) {
		text.insert(0, markdown);
		doc.commit();
	}
	const author = opts.author ?? "human";
	const [row] = await db
		.insert(docs)
		.values({
			title,
			markdown,
			loroSnapshot: snapshotB64(doc),
			status: opts.status ?? "final",
			...(opts.chatUuid ? { chatUuid: opts.chatUuid } : {}),
		})
		.returning();
	await db.insert(docVersions).values({ docId: row.id, content: markdown, author, chatUuid: opts.chatUuid });
	return row;
}

export async function listDocs(): Promise<Doc[]> {
	return db.select().from(docs).orderBy(desc(docs.updatedAt)).limit(100);
}

export async function getDoc(id: string): Promise<Doc | null> {
	// ponytail: docs.id is uuid — a slug like "loom-scripts" makes postgres throw
	// "invalid input syntax for type uuid" instead of returning no rows. Guard so
	// callers get the clean not-found path. Swap for a slug->id lookup if agents
	// keep naming docs by slug.
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
	const [row] = await db.select().from(docs).where(eq(docs.id, id));
	return row ?? null;
}

export async function saveDocMarkdown(
	id: string,
	markdown: string,
	author: "agent" | "human" = "human",
	chatUuid?: string,
) {
	const row = await getDoc(id);
	if (!row) throw new Error(`doc not found: ${id}`);
	const { doc, text } = loroFromSnapshot(row.loroSnapshot);
	applyMarkdown(text, markdown);
	doc.commit();

	const now = new Date();
	const [lastVersion] = await db
		.select({ id: docVersions.id, author: docVersions.author, createdAt: docVersions.createdAt })
		.from(docVersions)
		.where(eq(docVersions.docId, id))
		.orderBy(desc(docVersions.createdAt))
		.limit(1);

	await db
		.update(docs)
		.set({
			markdown,
			loroSnapshot: snapshotB64(doc),
			version: row.version + 1,
			// human touch = reviewed; agent write re-opens review
			status: author === "human" ? "final" : "draft",
		})
		.where(eq(docs.id, id));

	if (shouldCoalesceVersion(lastVersion, author, now)) {
		await db
			.update(docVersions)
			.set({ content: markdown, ...(chatUuid ? { chatUuid } : {}) })
			.where(eq(docVersions.id, lastVersion.id));
	} else {
		await db.insert(docVersions).values({ docId: id, content: markdown, author, chatUuid });
	}
	return { version: row.version + 1 };
}

export async function renameDoc(id: string, title: string) {
	await db.update(docs).set({ title }).where(eq(docs.id, id));
}

export async function setDocStatus(id: string, status: "draft" | "final") {
	await db.update(docs).set({ status }).where(eq(docs.id, id));
}

export async function toggleShare(id: string, enabled: boolean): Promise<string | null> {
	const token = enabled ? randomBytes(12).toString("hex") : null;
	await db.update(docs).set({ shareToken: token }).where(eq(docs.id, id));
	return token;
}

export async function getDocVersions(docId: string): Promise<DocVersion[]> {
	return db
		.select()
		.from(docVersions)
		.where(eq(docVersions.docId, docId))
		.orderBy(asc(docVersions.createdAt));
}

/** Unified diff of one version against the version immediately before it. */
export async function getVersionDiff(docId: string, versionId: string): Promise<string | null> {
	const versions = await getDocVersions(docId);
	const idx = versions.findIndex((v) => v.id === versionId);
	if (idx === -1) return null;
	return unifiedDiff(idx > 0 ? versions[idx - 1].content : "", versions[idx].content);
}

/** Agent write: append (default) or replace, attributed + versioned, re-opens review. */
export async function agentWrite(input: {
	docId: string;
	content: string;
	chatUuid: string;
	mode?: "append" | "replace";
}): Promise<{ docId: string; version: number }> {
	const row = await getDoc(input.docId);
	if (!row) throw new Error(`doc not found: ${input.docId}`);

	const next =
		input.mode === "replace"
			? input.content
			: (row.markdown ? row.markdown.replace(/\n*$/, "\n\n") : "") + input.content + "\n";

	const { version } = await saveDocMarkdown(input.docId, next, "agent", input.chatUuid);
	return { docId: input.docId, version };
}
