// Tracked-text layer shared by docs and email drafts: a Loro doc holding one
// text + a coalesced `text_versions` timeline. Human saves arrive as full
// content; we convert old→new into Loro hunks so a concurrent agent write
// merges instead of clobbering (char-level CRDT, same lib macro uses).
//
// ponytail: single-text Loro doc + diff-hunk deltas replaces macro's 2.8k-line
// @loro-mirror/core tree mirror — our surfaces are one text each. If any
// surface ever becomes a multi-writer tree, vendor
// ~/GitHub/macro/packages/loro-mirror instead.
import { desc, eq, and } from "drizzle-orm";
import { LoroDoc, type LoroText } from "loro-crdt";
import { diffWordsWithSpace } from "diff";
import { db } from "~/db";
import { textVersions, type TextVersion } from "~/db/schema";

export type TrackedEntity = "doc" | "email_draft";

function loroFromSnapshot(snapshotB64: string | null | undefined): { doc: LoroDoc; text: LoroText } {
	const doc = new LoroDoc();
	if (snapshotB64) {
		try {
			doc.import(new Uint8Array(Buffer.from(snapshotB64, "base64")));
		} catch {
			// corrupt/absent snapshot — start fresh; the content column stays truth
		}
	}
	return { doc, text: doc.getText("content") };
}

/**
 * Apply full-content replacement as diff hunks so the Loro history records
 * what actually changed instead of a delete-all + insert-all clobber (which
 * also defeats concurrent agent writes). Returns true if anything changed.
 */
export function applyTextHunks(text: LoroText, next: string): boolean {
	const current = text.toString();
	if (current === next) return false;
	let pos = 0;
	for (const part of diffWordsWithSpace(current, next)) {
		if (part.added) {
			text.insert(pos, part.value);
			pos += part.value.length;
		} else if (part.removed) {
			text.delete(pos, part.value.length);
		} else {
			pos += part.value.length;
		}
	}
	return true;
}

// A save burst inside this window by the same author updates the existing
// version row instead of adding one per autosave — the timeline reads like
// edit sessions, not keystroke noise.
const SESSION_MS = 10 * 60 * 1000;

async function recordVersion(
	entity: TrackedEntity,
	entityId: string,
	author: "human" | "agent",
	content: string,
): Promise<number> {
	const [last] = await db
		.select()
		.from(textVersions)
		.where(and(eq(textVersions.entity, entity), eq(textVersions.entityId, entityId)))
		.orderBy(desc(textVersions.version))
		.limit(1);
	if (last && last.author === author && Date.now() - last.updatedAt.getTime() < SESSION_MS) {
		await db.update(textVersions).set({ content }).where(eq(textVersions.id, last.id));
		return last.version;
	}
	const version = (last?.version ?? 0) + 1;
	await db.insert(textVersions).values({ entity, entityId, version, author, content });
	return version;
}

/**
 * CRDT-track a content change. Returns the new version + updated snapshot to
 * persist on the owning row, or null when nothing changed (caller skips its
 * own write — no-op saves must not bump anything).
 */
export async function trackText(
	entity: TrackedEntity,
	entityId: string,
	prevSnapshot: string,
	author: "human" | "agent",
	next: string,
): Promise<{ version: number; loroSnapshot: string } | null> {
	const { doc, text } = loroFromSnapshot(prevSnapshot);
	if (!applyTextHunks(text, next)) return null;
	doc.commit();
	const version = await recordVersion(entity, entityId, author, next);
	return {
		version,
		loroSnapshot: Buffer.from(doc.export({ mode: "snapshot" })).toString("base64"),
	};
}

export async function listTextVersions(
	entity: TrackedEntity,
	entityId: string,
): Promise<Omit<TextVersion, "content">[]> {
	return db
		.select({
			id: textVersions.id,
			entity: textVersions.entity,
			entityId: textVersions.entityId,
			version: textVersions.version,
			author: textVersions.author,
			createdAt: textVersions.createdAt,
			updatedAt: textVersions.updatedAt,
		})
		.from(textVersions)
		.where(and(eq(textVersions.entity, entity), eq(textVersions.entityId, entityId)))
		.orderBy(desc(textVersions.version));
}

/** Word-level diff between version N and N-1, computed server-side. */
export async function getTextVersionDiff(
	entity: TrackedEntity,
	entityId: string,
	version: number,
): Promise<{ parts: Array<{ added?: boolean; removed?: boolean; value: string }> } | null> {
	const rows = await db
		.select({ version: textVersions.version, content: textVersions.content })
		.from(textVersions)
		.where(and(eq(textVersions.entity, entity), eq(textVersions.entityId, entityId)))
		.orderBy(desc(textVersions.version));
	const cur = rows.find((r) => r.version === version);
	if (!cur) return null;
	const prev = rows.find((r) => r.version === version - 1);
	return { parts: diffWordsWithSpace(prev?.content ?? "", cur.content) };
}

/** Remove a tracked text's timeline (call when the owning row is deleted). */
export async function deleteTextVersions(entity: TrackedEntity, entityId: string) {
	await db.delete(textVersions).where(and(eq(textVersions.entity, entity), eq(textVersions.entityId, entityId)));
}
