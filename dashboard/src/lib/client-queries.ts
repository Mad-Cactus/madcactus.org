import { query, action, redirect } from "@solidjs/router";
import { getClientClient, clientSignIn } from "./client-session";
import { generateApiKey, hashKey, keyPrefix } from "./crypto";
import type {
	ApiKey,
	Document,
	Invoice,
	Project,
	Deliverable,
	DeliverableUpdate,
} from "./supabase";

// ── Client portal queries ──────────────────────────────────────────

export const getClientUserQuery = query(async () => {
	"use server";
	const cc = await getClientClient();
	if (!cc) throw redirect("/portal/login");
	return { id: cc.client.id, name: cc.client.name, email: cc.client.email };
}, "client-user");

export const getClientDashboardQuery = query(async () => {
	"use server";
	const cc = await getClientClient();
	if (!cc) throw redirect("/portal/login");
	const { supabase, client } = cc;

	const { data: project } = await supabase
		.from("projects")
		.select("*")
		.eq("id", client.project_id)
		.single();

	const { data: deliverables } = await supabase
		.from("deliverables")
		.select("*, updates:deliverable_updates(*)")
		.eq("project_id", client.project_id)
		.order("sort_order");

	const { count: docCount } = await supabase
		.from("documents")
		.select("id", { count: "exact", head: true })
		.eq("project_id", client.project_id)
		.eq("visibility", "client");

	const { count: invoiceCount } = await supabase
		.from("invoices")
		.select("id", { count: "exact", head: true })
		.eq("project_id", client.project_id)
		.in("status", ["sent", "draft"]);

	return {
		project: project as Project,
		deliverables: (deliverables ?? []) as (Deliverable & {
			updates: DeliverableUpdate[];
		})[],
		docCount: docCount ?? 0,
		invoiceCount: invoiceCount ?? 0,
	};
}, "client-dashboard");

export const getClientDocumentsQuery = query(async () => {
	"use server";
	const cc = await getClientClient();
	if (!cc) throw redirect("/portal/login");
	const { data } = await cc.supabase
		.from("documents")
		.select("*")
		.eq("project_id", cc.client.project_id)
		.eq("visibility", "client")
		.order("created_at", { ascending: false });
	return (data ?? []) as Document[];
}, "client-documents");

export const getClientInvoicesQuery = query(async () => {
	"use server";
	const cc = await getClientClient();
	if (!cc) throw redirect("/portal/login");
	const { data } = await cc.supabase
		.from("invoices")
		.select("*")
		.eq("project_id", cc.client.project_id)
		.order("created_at", { ascending: false });
	return (data ?? []) as Invoice[];
}, "client-invoices");

export const getClientApiKeysQuery = query(async () => {
	"use server";
	const cc = await getClientClient();
	if (!cc) throw redirect("/portal/login");
	const { data } = await cc.supabase
		.from("api_keys")
		.select("id, client_id, label, key_prefix, last_used_at, revoked_at, created_at")
		.eq("client_id", cc.client.id)
		.order("created_at", { ascending: false });
	return (data ?? []) as ApiKey[];
}, "client-api-keys");

// ── Client portal actions ──────────────────────────────────────────

export const clientLoginAction = action(async (formData: FormData) => {
	"use server";
	const email = String(formData.get("email"));
	const password = String(formData.get("password"));
	const result = await clientSignIn(email, password);
	if (result.error) return { error: result.error };
	throw redirect("/portal");
}, "client-login");

export const createApiKeyAction = action(async (formData: FormData) => {
	"use server";
	const cc = await getClientClient();
	if (!cc) throw redirect("/portal/login");
	const label = String(formData.get("label") || "Default");
	const rawKey = generateApiKey();
	const { error } = await cc.supabase.from("api_keys").insert({
		client_id: cc.client.id,
		label,
		key_hash: hashKey(rawKey),
		key_prefix: keyPrefix(rawKey),
	});
	if (error) return { error: error.message };
	// Return the raw key once — client must copy it now
	return { key: rawKey };
}, "createApiKey");

export const revokeApiKeyAction = action(async (formData: FormData) => {
	"use server";
	const cc = await getClientClient();
	if (!cc) throw redirect("/portal/login");
	const id = String(formData.get("id"));
	const { error } = await cc.supabase
		.from("api_keys")
		.update({ revoked_at: new Date().toISOString() })
		.eq("id", id)
		.eq("client_id", cc.client.id);
	if (error) return { error: error.message };
	throw redirect("/portal/api-keys");
}, "revokeApiKey");
