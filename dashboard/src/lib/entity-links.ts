// entity_links — cross-references between components (@[kind:id] mentions,
// agent-created links). Kinds are validated against the registry here (the
// lib layer is the gate; the DB has no trigger). Ownership never goes through
// this table — real FKs on component tables own rows and cascade; links
// persist when a target is deleted and its card renders "deleted".
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "~/db";
import { entityLinks } from "~/db/schema";
import { getComponent, linksFor, resolveCard, type ComponentLinks } from "~/registry/registry";
import type { EntityRef } from "~/registry/types";

/** @[kind:id] — kind is [a-z0-9-]+, id is a uuid or a short-link slug. */
export const MENTION_RE = /@\[([a-z0-9-]+):([a-z0-9-]+)\]/gi;

/** All mentions in a markdown body, deduped. Unknown kinds are skipped
 *  (a future kind removed from the registry degrades to raw text, and link
 *  sync ignores it). */
export function parseMentions(markdown: string): EntityRef[] {
	const seen = new Map<string, EntityRef>();
	for (const m of markdown.matchAll(MENTION_RE)) {
		const kind = m[1];
		if (!getComponent(kind)) continue;
		seen.set(`${kind}:${m[2]}`, { kind, id: m[2] });
	}
	return [...seen.values()];
}

export class UnknownKindError extends Error {
	constructor(kind: string) {
		super(`unknown component kind "${kind}" — call list_component_types for the registry`);
	}
}

function assertKind(kind: string) {
	if (!getComponent(kind)) throw new UnknownKindError(kind);
}

/** Create (or idempotently confirm) a cross-reference. */
export async function linkComponents(
	from: EntityRef,
	to: EntityRef,
	opts: { linkType?: string; context?: string | null; createdBy?: "human" | "agent" } = {},
): Promise<void> {
	assertKind(from.kind);
	assertKind(to.kind);
	await db
		.insert(entityLinks)
		.values({
			fromKind: from.kind,
			fromId: from.id,
			toKind: to.kind,
			toId: to.id,
			linkType: opts.linkType ?? "mentions",
			context: opts.context ?? null,
			createdBy: opts.createdBy ?? "human",
		})
		.onConflictDoNothing({
			target: [entityLinks.fromKind, entityLinks.fromId, entityLinks.toKind, entityLinks.toId, entityLinks.linkType],
		});
}

export async function unlinkComponents(from: EntityRef, to: EntityRef, linkType = "mentions"): Promise<void> {
	await db
		.delete(entityLinks)
		.where(
			and(
				eq(entityLinks.fromKind, from.kind),
				eq(entityLinks.fromId, from.id),
				eq(entityLinks.toKind, to.kind),
				eq(entityLinks.toId, to.id),
				eq(entityLinks.linkType, linkType),
			),
		);
}

/** Links for one component with resolved cards (entity_links + declared FKs). */
export async function listLinks(ref: EntityRef): Promise<ComponentLinks> {
	return linksFor(ref);
}

/** Keep entity_links (link_type='mentions') in sync with a doc's markdown.
 *  Called from saveDocMarkdown — the one server-side funnel for editor
 *  autosaves and agent write_doc alike, so backlinks exist without any
 *  agent effort. Upsert new mentions, drop stale ones; idempotent. */
export async function syncDocMentions(docId: string, markdown: string): Promise<void> {
	const desired = parseMentions(markdown);
	const existing = await db
		.select({ toKind: entityLinks.toKind, toId: entityLinks.toId })
		.from(entityLinks)
		.where(
			and(
				eq(entityLinks.fromKind, "doc"),
				eq(entityLinks.fromId, docId),
				eq(entityLinks.linkType, "mentions"),
			),
		);
	const existingKeys = new Set(existing.map((r) => `${r.toKind}:${r.toId}`));
	const desiredKeys = new Set(desired.map((r) => `${r.kind}:${r.id}`));

	for (const ref of desired) {
		if (!existingKeys.has(`${ref.kind}:${ref.id}`)) {
			await linkComponents({ kind: "doc", id: docId }, ref, { createdBy: "agent" });
		}
	}
	const stale = existing.filter((r) => !desiredKeys.has(`${r.toKind}:${r.toId}`));
	if (stale.length) {
		// composite text key — drizzle can't tuple-in, so concat + inArray
		await db
			.delete(entityLinks)
			.where(
				and(
					eq(entityLinks.fromKind, "doc"),
					eq(entityLinks.fromId, docId),
					eq(entityLinks.linkType, "mentions"),
					inArray(
						sql`${entityLinks.toKind} || ':' || ${entityLinks.toId}`,
						stale.map((r) => `${r.toKind}:${r.toId}`),
					),
				),
			);
	}
}
