import {
	pgTable,
	uuid,
	text,
	timestamp,
	boolean,
	integer,
	pgEnum,
	index,
	uniqueIndex,
	primaryKey,
	bigint,
	pgView,
	doublePrecision,
	check,
	jsonb,
	real,
	date,
} from "drizzle-orm/pg-core";
import { sql, eq } from "drizzle-orm";

// ── Enums ──────────────────────────────────────────────────────────

export const engagementType = pgEnum("engagement_type", [
	"retainer",
	"hourly",
	"project",
]);

export const projectStatus = pgEnum("project_status", [
	"active",
	"paused",
	"completed",
]);

export const deliverableStatus = pgEnum("deliverable_status", [
	"planned",
	"in_progress",
	"review",
	"completed",
	"blocked",
]);

export const documentType = pgEnum("document_type", [
	"link",
	"file",
	"transcript",
]);

export const documentVisibility = pgEnum("document_visibility", [
	"client",
	"internal",
	// unpublished meeting draft pushed by the Anarlog publisher; invisible to
	// clients until explicitly published from /admin/meetings
	"draft",
]);

export const invoiceStatus = pgEnum("invoice_status", [
	"draft",
	"sent",
	"paid",
	"void",
]);

// ── Outreach pipeline (admin CRM-lite) ─────────────────────────────

// Single source of truth for stage values — the column default, the check
// constraint, and the UI advance buttons all derive from this array.
export const OUTREACH_STAGES = [
	"proposed",
	"sent",
	"watching",
	"replied",
	"meeting",
	"won",
	"shutdown",
] as const;

export type OutreachStage = (typeof OUTREACH_STAGES)[number];

export const outreachProspects = pgTable(
	"outreach_prospects",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		company: text("company").notNull(),
		contactName: text("contact_name"),
		email: text("email"),
		stage: text("stage").notNull().default("sent"),
		nextActionAt: timestamp("next_action_at", { withTimezone: true }),
		nextActionNote: text("next_action_note"),
		brainUrl: text("brain_url"),
		// secret the brain's /activity endpoint expects (x-activity-key). Lives
		// here, not in an env secret — one row per prospect, editable in the UI.
		brainActivityKey: text("brain_activity_key"),
		videoUrl: text("video_url"),
		// email link points at /v/:id → 302 here after logging the click
		videoViewCount: integer("video_view_count").notNull().default(0),
		videoFirstViewedAt: timestamp("video_first_viewed_at", { withTimezone: true }),
		videoLastViewedAt: timestamp("video_last_viewed_at", { withTimezone: true }),
		videoWatchSeconds: integer("video_watch_seconds").notNull().default(0),
		videoMaxPosition: integer("video_max_position").notNull().default(0),
		videoDurationSeconds: integer("video_duration_seconds"),
		videoCompleted: boolean("video_completed").notNull().default(false),
		notes: text("notes"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [
		// stage values come from the static const above — safe to inline raw
		check(
			"outreach_stage_check",
			sql`${t.stage} in ${sql.raw(`(${OUTREACH_STAGES.map((s) => `'${s}'`).join(", ")})`)}`,
			),
		],
	);

// ponytail: doublePrecision (float8) instead of numeric. Float8 gives 15-digit
// precision with native JS numbers — no string conversion needed. Real money
// columns would use numeric, but this app's amounts never exceed 7 digits.
// Upgrade to numeric if billion-dollar invoices become a concern.

// ── Companies (the org / client company) ───────────────────────────

export const companies = pgTable("companies", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	// pseudonyms the meeting publisher matches against Anarlog titles,
	// stored as a JSON array of strings (e.g. ["CDL", "Customs Data Lock"])
	aliases: text("aliases"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at")
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
});

// ── Client members (the person / portal login) ─────────────────────

export const clientMembers = pgTable("client_members", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	// ponytail: nullable — Supabase Auth is the password store now (invite-by-email).
	// Column retained for back-compat, unused going forward. Drop in a future cleanup.
	passwordHash: text("password_hash"),
	isActive: boolean("is_active").notNull().default(true),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at")
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
});

// ── Junction: members ↔ companies (many-to-many) ───────────────────
// Same person can be on multiple companies; a company has multiple members.

export const clientCompanyMembers = pgTable(
	"client_company_members",
	{
		memberId: uuid("member_id")
			.notNull()
			.references(() => clientMembers.id, { onDelete: "cascade" }),
		companyId: uuid("company_id")
			.notNull()
			.references(() => companies.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.memberId, t.companyId] })],
);

// ── Projects / Engagements ─────────────────────────────────────────

export const projects = pgTable(
	"projects",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		name: text("name").notNull(),
		companyId: uuid("company_id")
			.notNull()
			.references(() => companies.id, { onDelete: "cascade" }),
		engagementType: engagementType("engagement_type")
			.notNull()
			.default("hourly"),
		hourlyRate: doublePrecision("hourly_rate").notNull().default(0),
		// fixed-price engagements (engagement_type = 'project')
		fixedPrice: doublePrecision("fixed_price"),
		// retainer only; null = uncapped
		monthlyCapHours: doublePrecision("monthly_cap_hours"),
		status: projectStatus("status").notNull().default("active"),
		notes: text("notes"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [index("idx_projects_company").on(t.companyId)],
);

// ── Time entries ───────────────────────────────────────────────────

export const timeEntries = pgTable(
	"time_entries",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		entryDate: timestamp("entry_date").notNull().defaultNow(),
		hours: doublePrecision("hours").notNull(),
		description: text("description").notNull(),
		billable: boolean("billable").notNull().default(true),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(t) => [
		index("idx_time_entries_date").on(t.entryDate),
		index("idx_time_entries_project").on(t.projectId),
	],
);

// ── Documents ──────────────────────────────────────────────────────

export const documents = pgTable(
	"documents",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		// nullable only for visibility='draft' meeting imports — assigned at
		// publish time. Publish action enforces non-null before flipping to client.
		projectId: uuid("project_id")
			.references(() => projects.id, { onDelete: "cascade" }),
		type: documentType("type").notNull().default("link"),
		title: text("title").notNull(),
		url: text("url"),
		fileName: text("file_name"),
		fileSize: bigint("file_size", { mode: "number" }),
		mimeType: text("mime_type"),
		description: text("description"),
		// full-text-searchable body (transcripts, pasted doc content)
		content: text("content"),
		visibility: documentVisibility("visibility")
			.notNull()
			.default("client"),
		// transcript audio attachment
		audioPath: text("audio_path"),
		audioFileName: text("audio_file_name"),
		// speaker blocks for meeting transcripts: JSON array of
		// { speaker, start_ms, end_ms, text } — drives the block editor + audio cuts
		transcriptJson: text("transcript_json"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(t) => [index("idx_documents_project").on(t.projectId)],
);

// ── Invoices ───────────────────────────────────────────────────────

export const invoices = pgTable(
	"invoices",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		number: text("number").notNull(),
		amount: doublePrecision("amount").notNull(),
		status: invoiceStatus("status").notNull().default("draft"),
		issueDate: timestamp("issue_date").notNull().defaultNow(),
		dueDate: timestamp("due_date"),
		paymentUrl: text("payment_url"),
		fileName: text("file_name"),
		fileSize: bigint("file_size", { mode: "number" }),
		storagePath: text("storage_path"),
		notes: text("notes"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(t) => [index("idx_invoices_project").on(t.projectId)],
);

// ── API Keys (per member — grants access to all their companies' projects) ─

export const apiKeys = pgTable(
	"api_keys",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		// null = admin-created key (not tied to a portal member) — used for
		// server-to-server auth like the Anarlog meeting publisher
		memberId: uuid("member_id")
			.references(() => clientMembers.id, { onDelete: "cascade" }),
		label: text("label").notNull().default("Default"),
		keyHash: text("key_hash").notNull().unique(),
		keyPrefix: text("key_prefix").notNull(),
		lastUsedAt: timestamp("last_used_at"),
		revokedAt: timestamp("revoked_at"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(t) => [
		index("idx_api_keys_member").on(t.memberId),
		index("idx_api_keys_hash").on(t.keyHash),
	],
);

// ── Deliverables ───────────────────────────────────────────────────

export const deliverables = pgTable(
	"deliverables",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		description: text("description").default(""),
		status: deliverableStatus("status").notNull().default("planned"),
		sortOrder: integer("sort_order").notNull().default(0),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [index("idx_deliverables_project").on(t.projectId)],
);

export const deliverableUpdates = pgTable(
	"deliverable_updates",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		deliverableId: uuid("deliverable_id")
			.notNull()
			.references(() => deliverables.id, { onDelete: "cascade" }),
		body: text("body").notNull(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(t) => [
		index("idx_deliverable_updates_deliverable").on(t.deliverableId),
	],
);

// ── Timer (singleton — one running timer, id always 1) ────────────
// A running timer is a row here; stopping converts it into a time entry.

export const timer = pgTable("timer", {
	id: integer("id").primaryKey(), // constrained to 1 via CHECK in migration 0004
	projectId: uuid("project_id")
		.notNull()
		.references(() => projects.id, { onDelete: "cascade" }),
	description: text("description").notNull().default(""),
	startedAt: timestamp("started_at").notNull().defaultNow(),
});

// ── View: monthly hours per project ────────────────────────────────

export const monthlyHoursByProject = pgView("monthly_hours_by_project").as(
	(q) =>
		q
			.select({
				projectId: projects.id,
				projectName: projects.name,
				month: sql`date_trunc('month', ${timeEntries.entryDate})`.as(
					"month",
				),
				hours: sql`sum(${timeEntries.hours})`.as("hours"),
			})
			.from(projects)
			.innerJoin(timeEntries, eq(timeEntries.projectId, projects.id))
			.groupBy(
				projects.id,
				projects.name,
				sql`date_trunc('month', ${timeEntries.entryDate})`,
			),
);

// publishing = scheduler claimed it and is dispatching; failed = dispatch
// errored (publish_error holds why) and stays visible for retry
export const docStatus = pgEnum("doc_status", ["draft", "final", "scheduled", "publishing", "published", "failed"]);
// null kind = plain doc; "post" = LinkedIn post, "newsletter" = Cactus Dispatch issue
export const docKind = pgEnum("doc_kind", ["post", "newsletter"]);

// ── Docs (CRDT markdown documents + version history) ───────────────

export const docs = pgTable(
	"docs",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		title: text("title").notNull().default("Untitled"),
		// markdown projection of the Loro doc — canonical for search/export/lint
		markdown: text("markdown").notNull().default(""),
		// base64 Loro snapshot — CRDT merge layer (agent appends vs human edits)
		loroSnapshot: text("loro_snapshot").notNull().default(""),
		version: integer("version").notNull().default(0),
		// draft = awaiting human review (agent-pushed), final = human-approved
		status: docStatus("status").notNull().default("final"),
		// post/newsletter → Finalize button becomes Schedule; null → plain doc
		kind: docKind("kind"),
		scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
		publishedAt: timestamp("published_at", { withTimezone: true }),
		publishError: text("publish_error"),
		chatUuid: text("chat_uuid"),
		// set = publicly viewable at /share/<token>
		shareToken: text("share_token").unique(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
);

// OAuth tokens for scheduled publishing targets (LinkedIn). One row per
// provider — access tokens are short-lived (~60d) and refreshed on use.
export const socialAccounts = pgTable("social_accounts", {
	id: uuid("id").primaryKey().defaultRandom(),
	provider: text("provider").notNull().unique(), // "linkedin"
	memberUrn: text("member_urn"), // urn:li:person:xxxx
	accessToken: text("access_token").notNull(),
	refreshToken: text("refresh_token"),
	expiresAt: timestamp("expires_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
});

// Change history for any tracked text surface (docs, email drafts, …).
// Coalesced edit sessions — a row per save burst, not per autosave. The Loro
// snapshot on the owning row holds full CRDT history; this table is the
// human-readable timeline feeding the diff panels.
export const textVersions = pgTable(
	"text_versions",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		// "doc" | "email_draft" — owner table resolved by the lib layer
		entity: text("entity").notNull(),
		entityId: uuid("entity_id").notNull(),
		version: integer("version").notNull(),
		author: text("author").notNull().default("human"), // "human" | "agent"
		// full content snapshot at this version — diff computed on read
		content: text("content").notNull().default(""),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [uniqueIndex("text_versions_entity_ver_idx").on(t.entity, t.entityId, t.version)],
);

// ── Brain (gbrain-style distilled knowledge, native tables) ────────
// Ported from garrytan/gbrain's Postgres model: pages hold distilled
// knowledge, chunks make it retrievable, facts are atomic claims with
// supersession chains (never deleted — audit trail), takes are consolidated
// conclusions, open_loops track commitments. Tight coupling: provenance
// columns (source_table/source_id) point INTO workspace tables instead of
// gbrain's sources; company_id ties pages/loops to real clients.

export const brainEntityKind = pgEnum("brain_entity_kind", ["company", "person", "project", "topic", "prospect"]);
export const brainFactKind = pgEnum("brain_fact_kind", ["event", "preference", "commitment", "belief", "fact", "idea", "lesson"]);

// ── Voice lint (machine-checkable rules; prose lessons live in brain_facts) ──

export const voicePatterns = pgTable("voice_patterns", {
	id: uuid("id").primaryKey().defaultRandom(),
	rule: text("rule").notNull(),
	pattern: text("pattern").notNull(),
	patternType: text("pattern_type").notNull().default("literal"), // "literal" | "regex"
	direction: text("direction").notNull().default("avoid"), // "avoid" | "prefer"
	category: text("category").notNull().default("style"),
	beforeText: text("before_text"),
	afterText: text("after_text"),
	lessonText: text("lesson_text"), // originating lesson, for traceability
	confidence: real("confidence").notNull().default(1),
	enabled: boolean("enabled").notNull().default(true),
	overrideCount: integer("override_count").notNull().default(0),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// a human sending a draft despite its violations = signal the pattern is too
// strict; recorded per pattern so lessons can be adapted over time
export const voiceLintOverrides = pgTable("voice_lint_overrides", {
	id: uuid("id").primaryKey().defaultRandom(),
	patternId: uuid("pattern_id")
		.notNull()
		.references(() => voicePatterns.id, { onDelete: "cascade" }),
	outboxId: uuid("outbox_id"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const brainVisibility = pgEnum("brain_visibility", ["private", "world"]);
export const brainNotability = pgEnum("brain_notability", ["high", "medium", "low"]);
export const brainLoopType = pgEnum("brain_loop_type", [
	"commitment_owed_by_me",
	"commitment_owed_to_me",
	"unanswered_inbound",
	"unanswered_outbound",
	"decision_pending",
]);
export const brainLoopStatus = pgEnum("brain_loop_status", ["open", "done", "dropped", "stale"]);
export const brainLoopDetector = pgEnum("brain_loop_detector", ["deterministic_thread", "llm_extract", "manual"]);
export const brainTakeKind = pgEnum("brain_take_kind", ["fact", "take", "bet", "hypothesis"]);
export const brainJobStatus = pgEnum("brain_job_status", ["pending", "running", "done", "failed"]);

export const brainPages = pgTable(
	"brain_pages",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		// unique citation key, kebab-case — [source:slug] style
		slug: text("slug").notNull().unique(),
		// 'entity' (company/person/project/topic card) | 'take' | 'summary' | 'note'
		type: text("type").notNull().default("entity"),
		entityKind: brainEntityKind("entity_kind"),
		// tight coupling: entity pages for clients point at the CRM row
		companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
		title: text("title").notNull(),
		// distilled body — synthesized from facts/takes by the enrich phase
		compiledTruth: text("compiled_truth").notNull().default(""),
		timelineText: text("timeline_text").notNull().default(""),
		frontmatter: jsonb("frontmatter").notNull().default({}),
		contentHash: text("content_hash"),
		// deterministic 0..1 salience (recency + loop pressure + notability),
		// recomputed by the cycle — ranks search results
		emotionalWeight: real("emotional_weight").notNull().default(0),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
		lastRetrievedAt: timestamp("last_retrieved_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [index("idx_brain_pages_company").on(t.companyId), index("idx_brain_pages_type").on(t.type)],
);

export const brainChunks = pgTable(
	"brain_chunks",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		pageId: uuid("page_id")
			.notNull()
			.references(() => brainPages.id, { onDelete: "cascade" }),
		chunkIndex: integer("chunk_index").notNull(),
		chunkText: text("chunk_text").notNull(),
		tokenCount: integer("token_count"),
		// v1 searches via to_tsvector expression index (see migration 0015);
		// embedding vector(1536) lands later on Supabase pgvector
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("idx_brain_chunks_page").on(t.pageId)],
);

export const brainFacts = pgTable(
	"brain_facts",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		entitySlug: text("entity_slug").notNull(),
		fact: text("fact").notNull(),
		kind: brainFactKind("kind").notNull().default("fact"),
		visibility: brainVisibility("visibility").notNull().default("private"),
		notability: brainNotability("notability").notNull().default("medium"),
		context: text("context"),
		validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
		validUntil: timestamp("valid_until", { withTimezone: true }),
		expiredAt: timestamp("expired_at", { withTimezone: true }),
		// supersession chain: newer fact points at the one it replaces
		supersededBy: uuid("superseded_by"),
		consolidatedAt: timestamp("consolidated_at", { withTimezone: true }),
		consolidatedInto: uuid("consolidated_into"),
		// surface this fact's rules apply to: 'docs' | 'email' | 'transcript' |
		// 'contract' | … — lessons are scoped per surface, global ones derive
		// from all of them during consolidation
		surface: text("surface"),
		// provenance INTO workspace tables: 'email_messages' | 'text_versions' |
		// 'documents' | 'manual'
		sourceTable: text("source_table").notNull(),
		sourceId: uuid("source_id"),
		confidence: real("confidence").notNull().default(1),
		// md5(lower(trim(fact))) — deterministic dedup key per entity
		factHash: text("fact_hash").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("idx_brain_facts_entity").on(t.entitySlug),
		uniqueIndex("brain_facts_entity_hash_uq").on(t.entitySlug, t.factHash),
	],
);

export const brainTakes = pgTable(
	"brain_takes",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		pageId: uuid("page_id")
			.notNull()
			.references(() => brainPages.id, { onDelete: "cascade" }),
		rowNum: integer("row_num").notNull(),
		claim: text("claim").notNull(),
		kind: brainTakeKind("kind").notNull().default("take"),
		holder: text("holder").notNull().default("madcactus"),
		// 0..1 conviction
		weight: real("weight").notNull().default(0.5),
		active: boolean("active").notNull().default(true),
		supersededBy: uuid("superseded_by"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [uniqueIndex("brain_takes_page_row_uq").on(t.pageId, t.rowNum)],
);

export const brainLinks = pgTable(
	"brain_links",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		fromPageId: uuid("from_page_id")
			.notNull()
			.references(() => brainPages.id, { onDelete: "cascade" }),
		toPageId: uuid("to_page_id")
			.notNull()
			.references(() => brainPages.id, { onDelete: "cascade" }),
		linkType: text("link_type").notNull().default(""),
		context: text("context").notNull().default(""),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [uniqueIndex("brain_links_from_to_type_uq").on(t.fromPageId, t.toPageId, t.linkType)],
);

export const brainTimeline = pgTable(
	"brain_timeline",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		pageId: uuid("page_id")
			.notNull()
			.references(() => brainPages.id, { onDelete: "cascade" }),
		date: date("date").notNull(),
		source: text("source").notNull().default(""),
		summary: text("summary").notNull(),
		detail: text("detail").notNull().default(""),
		// provenance: 'email_threads' | 'email_messages' | 'documents' | 'text_versions'
		sourceTable: text("source_table"),
		sourceId: uuid("source_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("idx_brain_timeline_page").on(t.pageId, t.date)],
);

export const brainOpenLoops = pgTable(
	"brain_open_loops",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		dedupKey: text("dedup_key").notNull().unique(),
		loopType: brainLoopType("loop_type").notNull(),
		companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
		counterpartySlug: text("counterparty_slug"),
		counterpartyEmail: text("counterparty_email"),
		summary: text("summary").notNull(),
		evidence: jsonb("evidence").notNull().default([]),
		threadId: uuid("thread_id").references(() => emailThreads.id, { onDelete: "set null" }),
		pageSlug: text("page_slug"),
		dueAt: timestamp("due_at", { withTimezone: true }),
		status: brainLoopStatus("status").notNull().default("open"),
		detector: brainLoopDetector("detector").notNull().default("deterministic_thread"),
		confidence: real("confidence").notNull().default(1),
		openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
		lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
		closedAt: timestamp("closed_at", { withTimezone: true }),
		closedBy: text("closed_by"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
);

export const brainJobs = pgTable(
	"brain_jobs",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		// 'extract_facts' | 'consolidate' | 'enrich' | 'detect_loops' | 'sync_entities'
		phase: text("phase").notNull(),
		scope: text("scope"),
		status: brainJobStatus("status").notNull().default("pending"),
		payload: jsonb("payload").notNull().default({}),
		attempts: integer("attempts").notNull().default(0),
		error: text("error"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [index("idx_brain_jobs_phase_status").on(t.phase, t.status)],
);

// cycle cursors + key/value state (mirrors gbrain's config + ingest_log)
export const brainState = pgTable("brain_state", {
	key: text("key").primaryKey(),
	value: jsonb("value").notNull().default({}),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
});

// ── Email (Gmail-backed inbox) ────────────────────

export const emailAccounts = pgTable("email_accounts", {
	id: uuid("id").primaryKey().defaultRandom(),
	email: text("email").notNull().unique(),
	// Google OAuth refresh token. ponytail: plaintext in the single-tenant DB —
	// the same DB already holds the Supabase service key via Fly secrets. Move
	// to encrypted-at-rest if this ever goes multi-tenant.
	refreshToken: text("refresh_token").notNull(),
	scopes: text("scopes"),
	// Gmail history API cursor for incremental sync
	syncHistoryId: text("sync_history_id"),
	lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emailThreads = pgTable(
	"email_threads",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		accountId: uuid("account_id")
			.notNull()
			.references(() => emailAccounts.id, { onDelete: "cascade" }),
		gmailThreadId: text("gmail_thread_id").notNull().unique(),
		subject: text("subject").notNull().default("(no subject)"),
		snippet: text("snippet"),
		// last-message sender display ("Eric Brownell", "me")
		fromName: text("from_name"),
		fromEmail: text("from_email"),
		unread: boolean("unread").notNull().default(false),
		// macro's "e" = mark done — archived threads leave the inbox
		archived: boolean("archived").notNull().default(false),
		lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("idx_email_threads_inbox").on(t.accountId, t.archived, t.lastMessageAt)],
);

export const emailMessages = pgTable(
	"email_messages",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		threadId: uuid("thread_id")
			.notNull()
			.references(() => emailThreads.id, { onDelete: "cascade" }),
		gmailId: text("gmail_id").notNull().unique(),
		fromName: text("from_name"),
		fromEmail: text("from_email"),
		toEmails: text("to_emails"),
		bodyText: text("body_text").notNull().default(""),
		date: timestamp("date", { withTimezone: true }).notNull(),
		isSent: boolean("is_sent").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("idx_email_messages_thread").on(t.threadId)],
);

export const emailOutbox = pgTable(
	"email_outbox",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		threadId: uuid("thread_id"), // set = reply, null = new thread
		toEmail: text("to_email").notNull(),
		subject: text("subject").notNull(),
		body: text("body").notNull(),
		// CRDT merge layer for the draft body — same pattern as docs.loroSnapshot
		loroSnapshot: text("loro_snapshot").notNull().default(""),
		version: integer("version").notNull().default(0),
		chatUuid: text("chat_uuid"),
		status: text("status").notNull().default("draft"), // draft|sending|sent|failed (sending = scheduler claimed)
		// set + status=draft = scheduled send — ticker fires via sendOutboxDraft
		sendAt: timestamp("send_at", { withTimezone: true }),
		gmailMessageId: text("gmail_message_id"),
		error: text("error"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [index("idx_email_outbox_status").on(t.status)],
);

// ── Slack (raw mirror — brain source, like email) ──────────────────

export const slackUsers = pgTable("slack_users", {
	id: uuid("id").primaryKey().defaultRandom(),
	slackId: text("slack_id").notNull().unique(),
	name: text("name").notNull().default(""),
	realName: text("real_name").notNull().default(""),
	email: text("email"),
	isBot: boolean("is_bot").notNull().default(false),
	deleted: boolean("deleted").notNull().default(false),
	syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const slackChannels = pgTable("slack_channels", {
	id: uuid("id").primaryKey().defaultRandom(),
	slackId: text("slack_id").notNull().unique(),
	name: text("name").notNull(),
	purpose: text("purpose").notNull().default(""),
	isArchived: boolean("is_archived").notNull().default(false),
	// null = never synced
	lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
});

export const slackMessages = pgTable(
	"slack_messages",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		channelId: uuid("channel_id")
			.notNull()
			.references(() => slackChannels.id, { onDelete: "cascade" }),
		// slack message ts — unique per channel, the natural message id
		ts: text("ts").notNull(),
		threadTs: text("thread_ts"),
		userId: text("user_id"),
		userName: text("user_name").notNull().default(""),
		text: text("text").notNull().default(""),
		isBot: boolean("is_bot").notNull().default(false),
		// slack timestamp → real time
		messageAt: timestamp("message_at", { withTimezone: true }).notNull(),
		syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("slack_messages_channel_ts_uq").on(t.channelId, t.ts),
		index("idx_slack_messages_date").on(t.messageAt),
	],
);

// ── Inferred types (replaces hand-maintained interfaces) ───────────

export type Company = typeof companies.$inferSelect;
export type ClientMember = typeof clientMembers.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Deliverable = typeof deliverables.$inferSelect;
export type DeliverableUpdate = typeof deliverableUpdates.$inferSelect;
export type Timer = typeof timer.$inferSelect;

// Type aliases for UI code (badge maps, selects, etc.)
export type EngagementType = Project["engagementType"];
export type ProjectStatus = Project["status"];
export type DeliverableStatus = Deliverable["status"];
export type DocumentType = Document["type"];
export type DocumentVisibility = Document["visibility"];
export type InvoiceStatus = Invoice["status"];
export type OutreachProspect = typeof outreachProspects.$inferSelect;
export type Doc = typeof docs.$inferSelect;
export type TextVersion = typeof textVersions.$inferSelect;
export type EmailAccount = typeof emailAccounts.$inferSelect;
export type EmailThread = typeof emailThreads.$inferSelect;
export type EmailMessage = typeof emailMessages.$inferSelect;
export type EmailOutbox = typeof emailOutbox.$inferSelect;
