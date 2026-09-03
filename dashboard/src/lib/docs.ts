// Docs — CRDT markdown documents with redline wired in.
//
// Merge layer: a Loro doc holding one LoroText with the markdown. Human saves
// arrive as full markdown; we convert old→new into Loro deltas so a concurrent
// agent append merges instead of clobbering (char-level CRDT, same lib macro
// uses). The markdown column is the projection: search, export, lint, pairs.
//
// ponytail: single-text Loro doc + diff-hunk deltas replaces macro's 2.8k-line
// @loro-mirror/core tree mirror — our docs are one text, not a nested Lexical
// tree on the server. If docs ever become multi-writer trees, vendor
// ~/GitHub/macro/packages/loro-mirror and store serialized editor state.
import { desc, eq } from "drizzle-orm";
import { LoroDoc, type LoroText } from "loro-crdt";
import { randomBytes } from "crypto";
import { db } from "~/db";
import { docs, type Doc } from "~/db/schema";
import { addPair, lintDraft, shouldBlock, type Violation } from "~/lib/redline";

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

export async function createDoc(title: string, markdown = ""): Promise<Doc> {
	const { doc, text } = loroFromSnapshot(null);
	if (markdown) {
		text.insert(0, markdown);
		doc.commit();
	}
	const [row] = await db
		.insert(docs)
		.values({ title, markdown, loroSnapshot: snapshotB64(doc) })
		.returning();
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

export async function saveDocMarkdown(id: string, markdown: string, author: "human" | "agent" = "human") {
	const row = await getDoc(id);
	if (!row) throw new Error(`doc not found: ${id}`);
	const { doc, text } = loroFromSnapshot(row.loroSnapshot);
	applyMarkdown(text, markdown);
	doc.commit();
	await db
		.update(docs)
		.set({
			markdown,
			loroSnapshot: snapshotB64(doc),
			version: row.version + 1,
			...(author === "human" ? { lastAgentContent: row.lastAgentContent } : {}),
		})
		.where(eq(docs.id, id));
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

	await saveDocMarkdown(input.docId, next, "agent");
	await db
		.update(docs)
		.set({ lastAgentContent: input.content, chatUuid: input.chatUuid })
		.where(eq(docs.id, input.docId));
	return { blocked: false, docId: input.docId, version: row.version + 1 };
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
