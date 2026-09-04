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

export const docStatus = pgEnum("doc_status", ["draft", "final"]);

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

// ── Company brain (generated memory — Macro-style unified memory) ──

export const memories = pgTable(
	"memories",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		// 'company' = whole firm; 'client' = scoped to one company
		scope: text("scope", { enum: ["company", "client"] }).notNull(),
		companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
		// the generated ~1000-3000 word memory blob, prepended to agent prompts
		content: text("content").notNull(),
		// 'generating' while a refresh is in flight; content stays servable
		status: text("status", { enum: ["ready", "generating", "failed"] })
			.notNull()
			.default("generating"),
		model: text("model"),
		lastError: text("last_error"),
		generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		// one live memory per (scope, client) — coalesce so the NULL company_id
		// of company-scope rows still collides
		uniqueIndex("memories_scope_company_uq").on(
			t.scope,
			sql`coalesce(${t.companyId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
		),
		index("idx_memories_company").on(t.companyId),
	],
);

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
		status: text("status").notNull().default("draft"), // draft|sent|failed
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
