import { query, action, redirect } from "@solidjs/router";
import { getAuthedClient } from "./session";
import { supabaseService } from "./supabase";
import { hashPassword } from "./crypto";
import { embed } from "./embeddings";
import type {
	Client,
	Document,
	Invoice,
	Deliverable,
	DeliverableUpdate,
} from "./supabase";

// ── Clients ────────────────────────────────────────────────────────

export const getClientsQuery = query(async () => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
	const { data } = await supabase
		.from("clients")
		.select("*, project:projects(name)")
		.order("created_at", { ascending: false });
	return (data ?? []) as (Client & { project: { name: string } | null })[];
}, "admin-clients");

export const getProjectsForSelectQuery = query(async () => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
	const { data } = await supabase
		.from("projects")
		.select("id, name, client_name")
		.order("name");
	return data ?? [];
}, "admin-projects-select");

export const createClientAction = action(async (formData: FormData) => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
	const { error } = await supabase.from("clients").insert({
		project_id: String(formData.get("project_id")),
		name: String(formData.get("name")),
		email: String(formData.get("email")).toLowerCase(),
		password_hash: hashPassword(String(formData.get("password"))),
	});
	if (error) return { error: error.message };
	throw redirect("/admin/clients");
}, "createClient");

export const updateClientPasswordAction = action(async (formData: FormData) => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
	const id = String(formData.get("id"));
	const password = String(formData.get("password"));
	if (!password || password.length < 6)
		return { error: "Password must be at least 6 characters" };
	const { error } = await supabase
		.from("clients")
		.update({ password_hash: hashPassword(password) })
		.eq("id", id);
	if (error) return { error: error.message };
	throw redirect("/admin/clients");
}, "updateClientPassword");

export const toggleClientActiveAction = action(async (formData: FormData) => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
	const id = String(formData.get("id"));
	const isActive = formData.get("is_active") === "true";
	const { error } = await supabase
		.from("clients")
		.update({ is_active: !isActive })
		.eq("id", id);
	if (error) return { error: error.message };
	throw redirect("/admin/clients");
}, "toggleClientActive");

// ── Documents ──────────────────────────────────────────────────────

export const getDocumentsQuery = query(async (projectId: string) => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
	const { data } = await supabase
		.from("documents")
		.select("*")
		.eq("project_id", projectId)
		.order("created_at", { ascending: false });
	return (data ?? []) as Document[];
}, "admin-documents");

export const createDocumentLinkAction = action(async (formData: FormData) => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
	const title = String(formData.get("title"));
	const description = String(formData.get("description") || "");
	const content = String(formData.get("content") || "");

	const embedText = [title, description, content].filter(Boolean).join("\n\n");
	let embedding: number[] | undefined;
	try {
		if (embedText.trim()) embedding = await embed(embedText);
	} catch (e) {
		console.error("Embedding failed:", e);
	}

	const { error } = await supabase.from("documents").insert({
		project_id: String(formData.get("project_id")),
		type: String(formData.get("type") || "link"),
		title,
		url: String(formData.get("url")),
		description,
		content: content || null,
		embedding,
		visibility: "client",
	});
	if (error) return { error: error.message };
	const ref = formData.get("_referer");
	throw redirect(ref ? String(ref) : "/admin/clients");
}, "createDocumentLink");

export const deleteDocumentAction = action(async (formData: FormData) => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
	const id = String(formData.get("id"));
	const storagePath = String(formData.get("storage_path") || "");
	const audioPath = String(formData.get("audio_path") || "");
	const paths = [storagePath, audioPath].filter(Boolean);
	if (paths.length) {
		const svc = supabaseService();
		await svc.storage.from("portal-docs").remove(paths);
	}
	const { error } = await supabase.from("documents").delete().eq("id", id);
	if (error) return { error: error.message };
	const ref = formData.get("_referer");
	throw redirect(ref ? String(ref) : "/clients");
}, "deleteDocument");

// ── Invoices ───────────────────────────────────────────────────────

export const getInvoicesQuery = query(async (projectId: string) => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
	const { data } = await supabase
		.from("invoices")
		.select("*")
		.eq("project_id", projectId)
		.order("created_at", { ascending: false });
	return (data ?? []) as Invoice[];
}, "admin-invoices");

export const createInvoiceAction = action(async (formData: FormData) => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
	const { error } = await supabase.from("invoices").insert({
		project_id: String(formData.get("project_id")),
		number: String(formData.get("number")),
		amount: Number(formData.get("amount")),
		status: String(formData.get("status") || "draft"),
		issue_date: String(formData.get("issue_date")),
		due_date: formData.get("due_date")
			? String(formData.get("due_date"))
			: null,
		payment_url: formData.get("payment_url")
			? String(formData.get("payment_url"))
			: null,
		notes: String(formData.get("notes") || ""),
	});
	if (error) return { error: error.message };
	const ref = formData.get("_referer");
	throw redirect(ref ? String(ref) : "/clients");
}, "createInvoice");

// ── Deliverables ─────────────────────────────────────────────────

export const getDeliverablesQuery = query(async (projectId: string) => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
	const { data } = await supabase
		.from("deliverables")
		.select("*, updates:deliverable_updates(*)")
		.eq("project_id", projectId)
		.order("sort_order");
	return (data ?? []) as (Deliverable & {
		updates: DeliverableUpdate[];
	})[];
}, "admin-deliverables");

export const createDeliverableAction = action(async (formData: FormData) => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");

	// Get next sort_order
	const projectId = String(formData.get("project_id"));
	const { data: existing } = await supabase
		.from("deliverables")
		.select("sort_order")
		.eq("project_id", projectId)
		.order("sort_order", { ascending: false })
		.limit(1);
	const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

	const { error } = await supabase.from("deliverables").insert({
		project_id: projectId,
		title: String(formData.get("title")),
		description: String(formData.get("description") || ""),
		sort_order: nextOrder,
	});
	if (error) return { error: error.message };
	const ref = formData.get("_referer");
	throw redirect(ref ? String(ref) : "/admin/projects");
}, "createDeliverable");

export const updateDeliverableStatusAction = action(
	async (formData: FormData) => {
		"use server";
		const supabase = await getAuthedClient();
		if (!supabase) throw redirect("/admin/login");
		const id = String(formData.get("id"));
		const status = String(formData.get("status"));
		const { error } = await supabase
			.from("deliverables")
			.update({ status, updated_at: new Date().toISOString() })
			.eq("id", id);
		if (error) return { error: error.message };
		const ref = formData.get("_referer");
		throw redirect(ref ? String(ref) : "/admin/projects");
},
	"updateDeliverableStatus",
);

export const addDeliverableUpdateAction = action(async (formData: FormData) => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
	const deliverableId = String(formData.get("deliverable_id"));
	const body = String(formData.get("body"));
	if (!body.trim()) return { error: "Update cannot be empty" };
	const { error } = await supabase.from("deliverable_updates").insert({
		deliverable_id: deliverableId,
		body,
	});
	// Touch parent updated_at
	if (!error) {
		await supabase
			.from("deliverables")
			.update({ updated_at: new Date().toISOString() })
			.eq("id", deliverableId);
	}
	if (error) return { error: error.message };
	const ref = formData.get("_referer");
	throw redirect(ref ? String(ref) : "/admin/projects");
}, "addDeliverableUpdate");

export const deleteDeliverableAction = action(async (formData: FormData) => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
	const id = String(formData.get("id"));
	const { error } = await supabase.from("deliverables").delete().eq("id", id);
	if (error) return { error: error.message };
	const ref = formData.get("_referer");
	throw redirect(ref ? String(ref) : "/admin/projects");
}, "deleteDeliverable");

export const deleteInvoiceAction = action(async (formData: FormData) => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
	const id = String(formData.get("id"));
	const storagePath = String(formData.get("storage_path") || "");
	if (storagePath) {
		const svc = supabaseService();
		await svc.storage.from("portal-docs").remove([storagePath]);
	}
	const { error } = await supabase.from("invoices").delete().eq("id", id);
	if (error) return { error: error.message };
	const ref = formData.get("_referer");
	throw redirect(ref ? String(ref) : "/clients");
}, "deleteInvoice");
