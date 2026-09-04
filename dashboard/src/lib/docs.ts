// Docs — CRDT markdown documents with redline wired in.
//
// Merge layer: a Loro doc holding one LoroText with the markdown, tracked via
// ~/lib/crdt-text (shared with email drafts). Human saves arrive as full
// markdown; we convert old→new into Loro deltas so a concurrent agent append
// merges instead of clobbering. The markdown column is the projection: search,
// export, lint, pairs.
import { desc, eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db } from "~/db";
import { docs, type Doc } from "~/db/schema";
import { addPair, lintDraft, shouldBlock, type Violation } from "~/lib/redline";
import { trackText, listTextVersions, getTextVersionDiff } from "~/lib/crdt-text";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Queries ────────────────────────────────────────────────────────

export async function createDoc(title: string, markdown = ""): Promise<Doc> {
	const [row] = await db.insert(docs).values({ title, markdown }).returning();
	if (markdown) {
		const tracked = await trackText("doc", row.id, "", "human", markdown);
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
			...(author === "human" ? { lastAgentContent: row.lastAgentContent } : {}),
		})
		.where(eq(docs.id, id));
	return tracked.version;
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
	const token = enabled ? randomBytes(12).toString("hex") : null;
	await db.update(docs).set({ shareToken: token }).where(eq(docs.id, id));
	return token;
}

// ── Redline integration ────────────────────────────────────────────

export type AgentWriteResult =
	| { blocked: true; violations: Violation[] }
	| { blocked: false; docId: string; version: number };

/**
 * gated_write for docs: lint against voice patterns first; avoid-violations
 * BLOCK (same contract as gbrain's gated_write in macro). On success, the
 * content is appended to the Loro doc and stamped as the agent's version for
 * the finalize pair.
 */
export async function agentWrite(input: {
	docId: string;
	content: string;
	chatUuid: string;
	mode?: "append" | "replace";
	force?: boolean;
}): Promise<AgentWriteResult> {
	const violations = await lintDraft(input.content);
	if (shouldBlock(violations) && !input.force) {
		return { blocked: true, violations };
	}
	const row = await getDoc(input.docId);
	if (!row) throw new Error(`doc not found: ${input.docId}`);

	const next =
		input.mode === "replace"
			? input.content
			: (row.markdown ? row.markdown.replace(/\n*$/, "\n\n") : "") + input.content + "\n";

	const version = await saveDocMarkdown(input.docId, next, "agent");
	await db
		.update(docs)
		.set({ lastAgentContent: input.content, chatUuid: input.chatUuid })
		.where(eq(docs.id, input.docId));
	return { blocked: false, docId: input.docId, version };
}

/**
 * Finalize: last agent write = draft, current markdown = final, diff computed,
 * pair stored, derivation job enqueued. Docs finalize via button; emails on send.
 */
export async function finalizeDoc(id: string): Promise<string> {
	const row = await getDoc(id);
	if (!row) throw new Error(`doc not found: ${id}`);
	if (!row.lastAgentContent) throw new Error("doc has no agent write to pair against");
	const pairId = await addPair({
		draftContent: row.lastAgentContent,
		finalContent: row.markdown,
		context: `doc: ${row.title}`,
		tags: "doc",
		chatUuid: row.chatUuid ?? undefined,
		surface: "doc",
	});
	await db.update(docs).set({ lastAgentContent: null }).where(eq(docs.id, id));
	return pairId.id;
}
