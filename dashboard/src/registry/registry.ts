// The component registry — the single map of the business.
//
// Every first-class business object (email, campaign, video, meeting,
// contact, company, …) is a component: registered here, addressable as
// { kind, id }, linked via entity_links, surfaced through generic MCP tools
// and hover cards. Adding a business object = defineComponent() + own table
// + admin route + registration here. Never bolt columns onto another
// component's table; never invent a new linking scheme.
//
// Server-only (imports ~/db). Client code reaches it through "use server"
// libs or /api/components/* routes.
import { and, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "~/db";
import {
	companies,
	clientMembers,
	projects,
	docs,
	documents,
	emailThreads,
	emailOutbox,
	campaigns,
	funnelRuns,
	outreachProspects,
	OUTREACH_STAGE_LABELS,
	videos,
	shortLinks,
	invoices,
	deliverables,
} from "~/db/schema";
import {
	defineComponent,
	type AnyComponentDefinition,
	type ComponentCard,
	type ComponentSearchHit,
	type ComponentTypeSummary,
	type EntityRef,
} from "./types";

// ── Registrations ──────────────────────────────────────────────────

const company = defineComponent({
	kind: "company",
	label: "Company",
	description:
		"A client company (the org). Owns projects, invoices, and deliverables; brain entity pages attach to it.",
	table: companies,
	title: (r) => r.name,
	subtitle: (r) => (r.aliases ? `aka ${r.aliases}` : null),
	adminPath: (r) => `/admin/companies/${r.id}`,
	search: { columns: [companies.name, companies.aliases] },
});

const contact = defineComponent({
	kind: "contact",
	label: "Contact",
	description:
		"A client-side person (portal login). Member of one or more companies; standalone admin page is future work.",
	table: clientMembers,
	title: (r) => r.name,
	subtitle: (r) => r.email,
	status: { get: (r) => (r.isActive ? "active" : "inactive") },
	search: { columns: [clientMembers.name, clientMembers.email] },
});

const project = defineComponent({
	kind: "project",
	label: "Project",
	description: "An engagement for one company (retainer/hourly/project) — the container for time, invoices, deliverables, documents.",
	table: projects,
	title: (r) => r.name,
	subtitle: (r) => `${r.engagementType} engagement`,
	status: { get: (r) => r.status },
	adminPath: (r) => `/admin/projects/${r.id}`,
	search: { columns: [projects.name, projects.notes] },
	ownerLinks: [{ key: "companyId", column: projects.companyId, kind: "company" }],
});

const doc = defineComponent({
	kind: "doc",
	label: "Doc",
	description:
		"CRDT markdown document — plain doc, LinkedIn post, or Cactus Dispatch issue. Agent writes land as versions for human review.",
	table: docs,
	title: (r) => r.title,
	subtitle: (r) => [r.kind ?? "doc", r.genre].filter(Boolean).join(" · "),
	status: {
		get: (r) => r.status,
		labels: { draft: "draft — awaiting human review" },
	},
	adminPath: (r) => `/admin/docs/${r.id}`,
	publicPath: (r) => (r.shareToken ? `/share/${r.shareToken}` : null),
	search: { columns: [docs.title] },
});

const emailThread = defineComponent({
	kind: "email-thread",
	label: "Email thread",
	description: "A Gmail-backed inbox thread — synced raw material the brain distills from.",
	table: emailThreads,
	title: (r) => r.subject,
	subtitle: (r) => r.fromEmail,
	status: {
		get: (r) => (r.archived ? "archived" : r.unread ? "unread" : "inbox"),
	},
	adminPath: () => `/admin/email`,
	search: { columns: [emailThreads.subject, emailThreads.snippet] },
});

const emailDraft = defineComponent({
	kind: "email-draft",
	label: "Email draft",
	description:
		"An outbox draft — agent-written email awaiting Collin's review (or scheduled auto-send). Campaign sends are real outbox rows.",
	table: emailOutbox,
	title: (r) => r.subject,
	subtitle: (r) => `to ${r.toEmail}`,
	status: { get: (r) => r.status },
	adminPath: () => `/admin/email`,
	search: { columns: [emailOutbox.subject, emailOutbox.toEmail] },
});

const campaign = defineComponent({
	kind: "campaign",
	label: "Campaign",
	description:
		"A named outreach email sequence. Frozen template copy lives on the campaign; target companies progress through touch cadences.",
	table: campaigns,
	title: (r) => r.name,
	subtitle: (r) => r.description,
	adminPath: () => `/admin/campaigns`,
	search: { columns: [campaigns.name, campaigns.description] },
});

const prospect = defineComponent({
	kind: "prospect",
	label: "Prospect",
	description:
		"An outreach pipeline company on the CRM board (candidate → … → won). Brain wiring, ICP fit, and its outreach video link here.",
	table: outreachProspects,
	title: (r) => r.company,
	subtitle: (r) => r.contactName ?? r.email,
	status: { get: (r) => r.stage, labels: OUTREACH_STAGE_LABELS },
	adminPath: () => `/admin/outreach`,
	search: {
		columns: [outreachProspects.company, outreachProspects.contactName, outreachProspects.email, outreachProspects.notes],
	},
	ownerLinks: [{ key: "campaignId", column: outreachProspects.campaignId, kind: "campaign" }],
});

const video = defineComponent({
	kind: "video",
	label: "Video",
	description: "An outreach Loom/recording with watch telemetry; linked from campaign emails via /v/:id.",
	table: videos,
	title: (r) => r.title,
	subtitle: (r) => r.url,
	status: { get: (r) => r.status },
	adminPath: () => `/admin/videos`,
	publicPath: (r) => `/v/${r.id}`,
	search: { columns: [videos.title, videos.description, videos.url] },
	ownerLinks: [{ key: "prospectId", column: videos.prospectId, kind: "prospect" }],
});

// meetings are documents rows with a transcript — same table, narrower view.
// where (not a separate table) is what keeps their cards/search consistent.
const meeting = defineComponent({
	kind: "meeting",
	label: "Meeting",
	description: "A meeting transcript (documents row with speaker blocks) — publishable to the client portal from /admin/meetings.",
	table: documents,
	where: isNotNull(documents.transcriptJson),
	title: (r) => r.title,
	subtitle: (r) => r.audioFileName ?? null,
	status: {
		get: (r) => r.visibility,
		labels: { client: "published", draft: "draft (unpublished)" },
	},
	adminPath: (r) => `/admin/meetings/${r.id}`,
	search: { columns: [documents.title] },
	ownerLinks: [{ key: "projectId", column: documents.projectId, kind: "project" }],
});

const shortLink = defineComponent({
	kind: "short-link",
	label: "Short link",
	description: "A tracked /l/<slug> redirect with human-only click counts — used in posts, newsletters, outreach.",
	table: shortLinks,
	// slug-keyed, not uuid — needs the custom loader
	load: async (id) => {
		const [row] = await db.select().from(shortLinks).where(eq(shortLinks.slug, id)).limit(1);
		return row ?? null;
	},
	title: (r) => `/l/${r.slug}`,
	subtitle: (r) => r.target,
	adminPath: () => `/admin/links`,
	publicPath: (r) => `/l/${r.slug}`,
	search: { columns: [shortLinks.slug, shortLinks.target] },
});

const invoice = defineComponent({
	kind: "invoice",
	label: "Invoice",
	description: "A project invoice (draft → sent → paid).",
	table: invoices,
	title: (r) => `Invoice ${r.number}`,
	subtitle: (r) => `$${r.amount}`,
	status: { get: (r) => r.status },
	adminPath: (r) => `/admin/projects/${r.projectId}`,
	search: { columns: [invoices.number, invoices.notes] },
	ownerLinks: [{ key: "projectId", column: invoices.projectId, kind: "project" }],
});

const deliverable = defineComponent({
	kind: "deliverable",
	label: "Deliverable",
	description: "A unit of work on a project (planned → in_progress → review → completed).",
	table: deliverables,
	title: (r) => r.title,
	subtitle: (r) => r.description || null,
	status: {
		get: (r) => r.status,
		labels: { in_progress: "in progress" },
	},
	adminPath: (r) => `/admin/projects/${r.projectId}`,
	search: { columns: [deliverables.title, deliverables.description] },
	ownerLinks: [{ key: "projectId", column: deliverables.projectId, kind: "project" }],
});

const funnelRun = defineComponent({
	kind: "funnel-run",
	label: "Funnel run",
	description:
		"One pull of companies through a staged ICP funnel — items verify stage by stage; all-stage survivors auto-promote into outreach.",
	table: funnelRuns,
	title: (r) => r.note ?? `Run ${r.id.slice(0, 8)}`,
	subtitle: (r) => `funnel run · ${r.source}`,
	status: { get: (r) => r.status },
	adminPath: (r) => `/admin/funnels/${r.id}`,
	search: { columns: [funnelRuns.note, funnelRuns.source] },
	// no ownerLinks: the parent funnel is static config (six stages), not an
	// addressable component — linking to an unregistered kind renders deleted cards
});

// NOTE: brain tables (brain_pages, brain_facts, …) are deliberately NOT
// registered — distilled knowledge is a separate subsystem with its own
// vocabulary (entity slugs). Unifying the two is a later, deliberate
// decision, not an omission.

/** Every component, keyed by kind. This object IS the map of the business. */
export const COMPONENTS: Record<string, AnyComponentDefinition> = {
	company: company as AnyComponentDefinition,
	contact: contact as AnyComponentDefinition,
	project: project as AnyComponentDefinition,
	doc: doc as AnyComponentDefinition,
	"email-thread": emailThread as AnyComponentDefinition,
	"email-draft": emailDraft as AnyComponentDefinition,
	campaign: campaign as AnyComponentDefinition,
	prospect: prospect as AnyComponentDefinition,
	video: video as AnyComponentDefinition,
	meeting: meeting as AnyComponentDefinition,
	"short-link": shortLink as AnyComponentDefinition,
	invoice: invoice as AnyComponentDefinition,
	deliverable: deliverable as AnyComponentDefinition,
	"funnel-run": funnelRun as AnyComponentDefinition,
};

export function getComponent(kind: string): AnyComponentDefinition | undefined {
	return COMPONENTS[kind];
}

/** Discovery list: kinds, labels, teaching descriptions, status vocab. */
export function listComponentTypes(): ComponentTypeSummary[] {
	return Object.values(COMPONENTS).map((d) => ({
		kind: d.kind,
		label: d.label,
		description: d.description,
		statuses: Object.keys(d.status?.labels ?? {}),
	}));
}

// ── Row loading + cards ────────────────────────────────────────────

export async function loadRow(def: AnyComponentDefinition, id: string): Promise<Record<string, unknown> | null> {
	if (def.load) return def.load(id);
	if (!def.table) return null;
	// biome-ignore lint/suspicious/noExplicitAny: heterogeneous registry table
	const tbl = def.table as any;
	const [row] = await db
		.select()
		.from(def.table)
		.where(and(eq(tbl.id, id), def.where ?? sql`true`))
		.limit(1);
	return (row as Record<string, unknown>) ?? null;
}

/** Row-level card projection. Missing rows resolve to deleted cards. */
export async function resolveCard(ref: EntityRef): Promise<ComponentCard> {
	const def = getComponent(ref.kind);
	if (!def) return deletedCard(ref);
	const row = await loadRow(def, ref.id);
	if (!row) return deletedCard(ref);
	return cardFromRow(def, row);
}

/** Batch card resolve (one db round-trip per distinct kind). */
export async function resolveCards(refs: EntityRef[]): Promise<ComponentCard[]> {
	return Promise.all(refs.map(resolveCard));
}

function deletedCard(ref: EntityRef): ComponentCard {
	return {
		kind: ref.kind,
		id: ref.id,
		title: ref.kind,
		subtitle: null,
		status: null,
		statusLabel: null,
		adminUrl: null,
		publicUrl: null,
		updatedAt: null,
		deleted: true,
	};
}

function cardFromRow(def: AnyComponentDefinition, row: Record<string, unknown>): ComponentCard {
	const status = def.status?.get(row) ?? null;
	const updatedRaw = (row.updatedAt ?? row.createdAt) as { toISOString?: () => string } | null;
	return {
		kind: def.kind,
		// biome-ignore lint/suspicious/noExplicitAny: registry rows are heterogeneous
		id: String(row.id ?? (row as any).slug ?? ""),
		title: def.title(row as never),
		subtitle: def.subtitle?.(row as never) ?? null,
		status,
		statusLabel: status === null ? null : def.status?.labels?.[status] ?? status,
		adminUrl: def.adminPath?.(row as never) ?? null,
		publicUrl: def.publicPath?.(row as never) ?? null,
		updatedAt: updatedRaw?.toISOString?.() ?? null,
		deleted: false,
	};
}

// ── Search ─────────────────────────────────────────────────────────

/** One query across every registered component (registry-driven union). */
export async function searchAll(q: string, limitPerKind = 5): Promise<ComponentSearchHit[]> {
	const needle = `%${q.trim()}%`;
	if (!q.trim()) return [];
	const results = await Promise.all(
		Object.values(COMPONENTS)
			.filter((d) => d.table && d.search?.columns.length)
			.map(async (def) => {
				const conds = def.search!.columns.map((c) => ilike(c, needle));
				// biome-ignore lint/suspicious/noExplicitAny: heterogeneous registry table
				const rows = await db
					.select()
					.from(def.table!)
					.where(and(def.where ?? sql`true`, or(...conds)))
					.limit(limitPerKind);
				return rows.map((row: Record<string, unknown>) => {
					const status = def.status?.get(row) ?? null;
					return {
						kind: def.kind,
						// biome-ignore lint/suspicious/noExplicitAny: slug-keyed kinds
						id: String(row.id ?? (row as any).slug ?? ""),
						title: def.title(row as never),
						subtitle: def.subtitle?.(row as never) ?? null,
						status,
						statusLabel: status === null ? null : def.status?.labels?.[status] ?? status,
					} satisfies ComponentSearchHit;
				});
			}),
	);
	return results.flat().slice(0, 40);
}

// ── Links ──────────────────────────────────────────────────────────

export type ResolvedLink = {
	direction: "out" | "in";
	linkType: string;
	context: string | null;
	card: ComponentCard;
};

export type ComponentLinks = {
	/** declared FK owners of this row (project → its company, video → its prospect) */
	owners: { via: string; card: ComponentCard }[];
	/** rows whose declared FKs point at this one (company ← its projects) */
	children: { via: string; card: ComponentCard }[];
	/** entity_links rows, both directions, with resolved cards */
	links: ResolvedLink[];
};

/** Complete link picture for a component: declared FKs (ownership) both
 *  directions + entity_links (references) both directions. Backlinks are
 *  whole from day one — existing FKs were never migrated into entity_links,
 *  they're reported from the registry instead. */
export async function linksFor(ref: EntityRef): Promise<ComponentLinks> {
	const def = getComponent(ref.kind);
	if (!def) return { owners: [], children: [], links: [] };
	const row = await loadRow(def, ref.id);

	// declared FK out: this row's owner columns → owner cards
	const owners: ComponentLinks["owners"] = [];
	if (row && def.ownerLinks) {
		for (const link of def.ownerLinks) {
			const value = row[link.key];
			if (typeof value === "string" && value) {
				owners.push({ via: link.key, card: await resolveCard({ kind: link.kind, id: value }) });
			}
		}
	}

	// declared FK in: other components whose ownerLinks point at this kind
	const children: ComponentLinks["children"] = [];
	await Promise.all(
		Object.values(COMPONENTS)
			.filter((d) => d !== def && d.table && d.ownerLinks?.some((l) => l.kind === ref.kind))
			.map(async (d) => {
				for (const link of d.ownerLinks!.filter((l) => l.kind === ref.kind)) {
					// biome-ignore lint/suspicious/noExplicitAny: heterogeneous registry table
					const rows = await db
						.select()
						.from(d.table!)
						.where(and(eq(link.column, ref.id), d.where ?? sql`true`))
						.limit(10);
					for (const r of rows as Record<string, unknown>[]) {
						children.push({ via: `${d.kind}.${link.key}`, card: cardFromRow(d, r) });
					}
				}
			}),
	);

	// entity_links both directions
	const { entityLinks } = await import("~/db/schema");
	const rows = await db
		.select()
		.from(entityLinks)
		.where(
			or(
				and(eq(entityLinks.fromKind, ref.kind), eq(entityLinks.fromId, ref.id)),
				and(eq(entityLinks.toKind, ref.kind), eq(entityLinks.toId, ref.id)),
			),
		)
		.limit(50);
	const links: ResolvedLink[] = await Promise.all(
		rows.map(async (r) => {
			const outbound = r.fromKind === ref.kind && r.fromId === ref.id;
			return {
				direction: outbound ? "out" : "in",
				linkType: r.linkType,
				context: r.context,
				card: await resolveCard(outbound ? { kind: r.toKind, id: r.toId } : { kind: r.fromKind, id: r.fromId }),
			};
		}),
	);

	return { owners, children, links };
}
