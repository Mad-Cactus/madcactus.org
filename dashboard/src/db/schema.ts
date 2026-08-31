import {
	pgTable,
	uuid,
	text,
	timestamp,
	boolean,
	integer,
	pgEnum,
	index,
	primaryKey,
	bigint,
	pgView,
	doublePrecision,
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
]);

export const invoiceStatus = pgEnum("invoice_status", [
	"draft",
	"sent",
	"paid",
	"void",
]);

// ponytail: doublePrecision (float8) instead of numeric. Float8 gives 15-digit
// precision with native JS numbers — no string conversion needed. Real money
// columns would use numeric, but this app's amounts never exceed 7 digits.
// Upgrade to numeric if billion-dollar invoices become a concern.

// ── Companies (the org / client company) ───────────────────────────

export const companies = pgTable("companies", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
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
		projectId: uuid("project_id")
			.notNull()
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
		memberId: uuid("member_id")
			.notNull()
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
