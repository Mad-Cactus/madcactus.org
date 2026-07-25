import { createClient } from "@supabase/supabase-js";

export type EngagementType = "retainer" | "hourly" | "project";
export type ProjectStatus = "active" | "paused" | "completed";
export type DocumentType = "link" | "file" | "transcript";
export type DocumentVisibility = "client" | "internal";
export type InvoiceStatus = "draft" | "sent" | "paid" | "void";

export interface Project {
	id: string;
	name: string;
	client_name: string;
	engagement_type: EngagementType;
	hourly_rate: number;
	monthly_cap_hours: number | null;
	status: ProjectStatus;
	notes: string | null;
	created_at: string;
	updated_at: string;
}

export interface TimeEntry {
	id: string;
	project_id: string;
	entry_date: string;
	hours: number;
	description: string;
	billable: boolean;
	created_at: string;
}

export interface EntryWithProject extends TimeEntry {
	project_name: string;
	client_name: string;
}

export interface Client {
	id: string;
	project_id: string;
	name: string;
	email: string;
	password_hash: string;
	is_active: boolean;
	created_at: string;
	updated_at: string;
}

export interface Document {
	id: string;
	project_id: string;
	type: DocumentType;
	title: string;
	url: string | null;
	file_name: string | null;
	file_size: number | null;
	mime_type: string | null;
	description: string | null;
	visibility: DocumentVisibility;
	created_at: string;
}

export interface Invoice {
	id: string;
	project_id: string;
	number: string;
	amount: number;
	status: InvoiceStatus;
	issue_date: string;
	due_date: string | null;
	payment_url: string | null;
	file_name: string | null;
	file_size: number | null;
	storage_path: string | null;
	notes: string | null;
	created_at: string;
}

export type DeliverableStatus =
	| "planned"
	| "in_progress"
	| "review"
	| "completed"
	| "blocked";

export interface Deliverable {
	id: string;
	project_id: string;
	title: string;
	description: string;
	status: DeliverableStatus;
	sort_order: number;
	created_at: string;
	updated_at: string;
}

export interface DeliverableUpdate {
	id: string;
	deliverable_id: string;
	body: string;
	created_at: string;
}

export interface ApiKey {
	id: string;
	client_id: string;
	label: string;
	key_prefix: string;
	last_used_at: string | null;
	revoked_at: string | null;
	created_at: string;
}

/**
 * Supabase client using anon/publishable key.
 * RLS-enforced. Used by admin server functions after setSession().
 */
export function supabaseAdmin() {
	return createClient(
		import.meta.env.VITE_SUPABASE_URL,
		import.meta.env.VITE_SUPABASE_ANON_KEY,
		{ auth: { persistSession: false, autoRefreshToken: false } },
	);
}

/**
 * Supabase client using service role key.
 * Bypasses RLS. Used for client portal queries (scoped by client_id in app code)
 * and MCP server queries (scoped by API key's client_id).
 */
export function supabaseService() {
	return createClient(
		import.meta.env.VITE_SUPABASE_URL,
		import.meta.env.VITE_SUPABASE_SERVICE_KEY,
		{ auth: { persistSession: false, autoRefreshToken: false } },
	);
}
