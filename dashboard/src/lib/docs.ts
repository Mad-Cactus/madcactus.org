// Docs — CRDT markdown documents with tracked version history.
//
// Merge layer: a Loro doc holding one LoroText with the markdown, tracked via
// ~/lib/crdt-text (shared with email drafts). Human saves arrive as full
// markdown; we convert old→new into Loro deltas so a concurrent agent append
// merges instead of clobbering. The markdown column is the projection: search,
// export, lint, pairs.
import { desc, eq } from "drizzle-orm";
import { randomHex } from "~/lib/crypto";
import { db } from "~/db";
import { docs, type Doc } from "~/db/schema";
import { lintVoiceText, type VoiceScope } from "~/lib/voice-lint-db";
import { docSurface } from "~/lib/voice-lint";
import { trackText, listTextVersions, getTextVersionDiff } from "~/lib/crdt-text-db";
import { UUID_RE } from "~/lib/uuid";

// ── Queries ────────────────────────────────────────────────────────

export async function createDoc(
	title: string,
	markdown = "",
	opts: {
		status?: "draft" | "final";
		author?: "human" | "agent";
		chatUuid?: string;
		kind?: "post" | "newsletter" | null;
		genre?: string | null;
	} = {},
): Promise<Doc> {
	const author = opts.author ?? "human";
	const [row] = await db
		.insert(docs)
		.values({
			title,
			markdown,
			status: opts.status ?? "final",
			...(opts.kind ? { kind: opts.kind } : {}),
			...(opts.genre ? { genre: opts.genre.trim().toLowerCase() } : {}),
			...(opts.chatUuid ? { chatUuid: opts.chatUuid } : {}),
		})
		.returning();
	if (markdown) {
		const tracked = await trackText("doc", row.id, "", author, markdown);
		if (tracked) {
			const [updated] = await db
				.update(docs)
				.set({ loroSnapshot: tracked.loroSnapshot, version: tracked.version })
				.where(eq(docs.id, row.id))
				.returning();
			return updated;
		}
	}
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
	if (!UUID_RE.test(id)) return null;
	const [row] = await db.select().from(docs).where(eq(docs.id, id));
	return row ?? null;
}

/** Returns the doc's new version number (unchanged if markdown identical). */
export async function saveDocMarkdown(
	id: string,
	markdown: string,
	author: "human" | "agent" = "human",
	chatUuid?: string,
): Promise<number> {
	const row = await getDoc(id);
	if (!row) throw new Error(`doc not found: ${id}`);
	const tracked = await trackText("doc", id, row.loroSnapshot, author, markdown);
	if (!tracked) return row.version;
	await db
		.update(docs)
		.set({
			markdown,
			loroSnapshot: tracked.loroSnapshot,
			version: tracked.version,
			// human touch = reviewed; agent write re-opens review. Publishing
			// states survive the save — editing a scheduled doc must not
			// silently unschedule it (the ticker publishes latest markdown).
			status:
				author === "human"
					? row.status === "scheduled" || row.status === "publishing" || row.status === "published"
						? row.status
						: "final"
					: "draft",
			...(chatUuid ? { chatUuid } : {}),
		})
		.where(eq(docs.id, id));
	return tracked.version;
}

export async function setDocStatus(id: string, status: "draft" | "final") {
	await db.update(docs).set({ status }).where(eq(docs.id, id));
}

export async function setDocKind(id: string, kind: "post" | "newsletter" | null) {
	await db.update(docs).set({ kind }).where(eq(docs.id, id));
}

export async function setDocGenre(id: string, genre: string | null) {
	const g = genre?.trim().toLowerCase() || null;
	await db.update(docs).set({ genre: g }).where(eq(docs.id, id));
}

/** Voice scope a doc's text lints/learns under — kind → surface, freeform genre. */
export function docVoiceScope(doc: Pick<Doc, "kind" | "genre">): VoiceScope {
	return { surface: docSurface(doc.kind), genre: doc.genre };
}

/** Queue a doc for the scheduler. Any status is allowed — rescheduling a
 *  failed or already-published doc is a normal correction. */
export async function scheduleDoc(id: string, when: Date, firstComment?: string | null) {
	await db
		.update(docs)
		.set({
			status: "scheduled",
			scheduledFor: when,
			publishError: null,
			...(firstComment !== undefined ? { firstComment: firstComment?.trim() || null } : {}),
		})
		.where(eq(docs.id, id));
}

export async function unscheduleDoc(id: string) {
	await db.update(docs).set({ status: "final", scheduledFor: null }).where(eq(docs.id, id));
}

export async function listDocVersions(docId: string) {
	if (!UUID_RE.test(docId)) return [];
	return listTextVersions("doc", docId);
}

/** Word-level diff between version N and N-1, computed server-side. */
export async function getDocVersionDiff(docId: string, version: number) {
	if (!UUID_RE.test(docId)) return null;
	return getTextVersionDiff("doc", docId, version);
}

export async function renameDoc(id: string, title: string) {
	await db.update(docs).set({ title }).where(eq(docs.id, id));
}

export async function toggleShare(id: string, enabled: boolean): Promise<string | null> {
	const token = enabled ? randomHex(12) : null;
	await db.update(docs).set({ shareToken: token }).where(eq(docs.id, id));
	return token;
}

// ── Agent writes ───────────────────────────────────────────────────

/**
 * Agent append/replace, attributed + versioned via crdt-text. The write
 * re-opens the doc for human review (status=draft); the human's next save
 * (or Mark final) closes it. The version timeline IS the learning record —
 * the brain reads these diffs during memory generation.
 */
export async function agentWrite(input: {
	docId: string;
	content: string;
	chatUuid: string;
	mode?: "append" | "replace";
	genre?: string | null;
}): Promise<{ docId: string; version: number; lint: Awaited<ReturnType<typeof lintVoiceText>> }> {
	const row = await getDoc(input.docId);
	if (!row) throw new Error(`doc not found: ${input.docId}`);

	// retag first so the lint + lesson derivation for THIS write use the new scope
	if (input.genre !== undefined) {
		await setDocGenre(input.docId, input.genre);
		row.genre = input.genre?.trim().toLowerCase() || null;
	}

	const next =
		input.mode === "replace"
			? input.content
			: (row.markdown ? row.markdown.replace(/\n*$/, "\n\n") : "") + input.content + "\n";

	const version = await saveDocMarkdown(input.docId, next, "agent", input.chatUuid);
	// advisory: violations ride back to the agent so it rewrites before finishing —
	// scoped to this doc's kind+genre so post rules stay out of plain docs
	const lint = await lintVoiceText(next, docVoiceScope(row));
	return { docId: input.docId, version, lint };
}
