// Component registry types — the vocabulary every first-class component of
// the business is defined in (see registry.ts). The registry is the single
// map of the business: agents + UIs read it instead of paraphrasing schema.
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/** A pointer to one component row — the shape @[kind:id] mentions encode. */
export type EntityRef = { kind: string; id: string };

/** The public face of a component row: everything a card, chip, or backlink
 *  list needs. Deleted targets resolve to { deleted: true } cards, never
 *  errors — a dangling mention degrades, it doesn't break rendering. */
export type ComponentCard = {
	kind: string;
	id: string;
	title: string;
	subtitle: string | null;
	status: string | null;
	statusLabel: string | null;
	adminUrl: string | null;
	publicUrl: string | null;
	updatedAt: string | null;
	deleted: boolean;
};

export type ComponentSearchHit = EntityRef & {
	title: string;
	subtitle: string | null;
	status: string | null;
	statusLabel: string | null;
};

export type ComponentTypeSummary = {
	kind: string;
	label: string;
	description: string;
	statuses: string[];
};

/** A declared ownership FK on this component's table → the kind it points at.
 *  Ownership cascades (deleting the parent deletes/orphans the child);
 *  cross-references use entity_links instead and never cascade. */
export type OwnerLink = { key: string; column: PgColumn; kind: string };

export type ComponentDefinition<T extends PgTable = PgTable> = {
	kind: string;
	label: string;
	/** teaching one-liner — what this component IS. Agents read these to
	 *  decide what to search/link without re-deriving the model. */
	description: string;
	/** generic load/search target. Omit only when `load` covers everything. */
	table?: T;
	/** extra filter for generic load/search — e.g. meetings are documents
	 *  rows with transcript_json, not their own table. */
	where?: SQL;
	/** custom row loader — short-link keys by slug, future virtual kinds. */
	load?: (id: string) => Promise<Record<string, unknown> | null>;
	title: (row: T["$inferSelect"]) => string;
	subtitle?: (row: T["$inferSelect"]) => string | null;
	/** raw status value + display labels; null status = no badge */
	status?: { get: (row: T["$inferSelect"]) => string | null; labels?: Record<string, string> };
	adminPath?: (row: T["$inferSelect"]) => string | null;
	publicPath?: (row: T["$inferSelect"]) => string | null;
	/** ILIKE columns searched by searchAll / search_components */
	search?: { columns: PgColumn[] };
	ownerLinks?: OwnerLink[];
};

/** Registry-internal view — definitions are stored heterogeneous. */
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous table generics
export type AnyComponentDefinition = ComponentDefinition<any>;

/** Identity factory: infers T from `table` so each definition's row
 *  callbacks are typed against its real Drizzle select type. */
export function defineComponent<T extends PgTable>(def: ComponentDefinition<T>): ComponentDefinition<T> {
	return def;
}
