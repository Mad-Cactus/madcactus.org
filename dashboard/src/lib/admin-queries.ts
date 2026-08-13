import { query, action, redirect } from "@solidjs/router";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";
import { getAuthedClient } from "./session";
import { supabaseService } from "./supabase";
import { db } from "~/db";
import {
	companies,
	clientMembers,
	clientCompanyMembers,
	projects,
	documents,
	invoices,
	deliverables,
	deliverableUpdates,
} from "~/db/schema";
import type {
	DocumentType,
	InvoiceStatus,
	DeliverableStatus,
} from "~/db/schema";

// ── Auth guard ────────────────────────────────────────────────────

async function requireAdmin() {
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
}

// ── Companies ─────────────────────────────────────────────────────

export const getCompaniesQuery = query(async () => {
	"use server";
	await requireAdmin();
	return db.select().from(companies).orderBy(desc(companies.createdAt));
}, "admin-companies");

export const createCompanyAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	await db.insert(companies).values({
		name: String(formData.get("name")),
	});
	throw redirect("/admin/companies");
}, "createCompany");

// ── Members ───────────────────────────────────────────────────────

export const getMembersQuery = query(async () => {
	"use server";
	await requireAdmin();
	return db.select().from(clientMembers).orderBy(desc(clientMembers.createdAt));
}, "admin-members");

export const getCompanyMembersQuery = query(async (companyId: string) => {
	"use server";
	await requireAdmin();
	return db
		.select({
			...getTableColumns(clientMembers),
		})
		.from(clientCompanyMembers)
		.innerJoin(
			clientMembers,
			eq(clientMembers.id, clientCompanyMembers.memberId),
		)
		.where(eq(clientCompanyMembers.companyId, companyId));
}, "admin-company-members");

export const createMemberAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const companyId = String(formData.get("company_id"));
	const email = String(formData.get("email")).toLowerCase();
	const name = String(formData.get("name"));

	const [member] = await db.insert(clientMembers).values({ name, email }).returning();

	// Link member to the company first so the row is fully usable regardless of
	// whether the invite email sends on the first try.
	await db
		.insert(clientCompanyMembers)
		.values({ memberId: member.id, companyId })
		.onConflictDoNothing();

	// Supabase sends the invite email; the client sets their own password.
	const redirectTo = inviteRedirect();
	const { error } = await supabaseService().auth.admin.inviteUserByEmail(email, {
		data: { name },
		...(redirectTo ? { redirectTo } : {}),
	});
	if (error)
		return { error: `Member created, but the invite email failed: ${error.message}` };

	return { success: `Member created. Invite sent to ${email}.` };
}, "createMember");

export const linkMemberAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const memberId = String(formData.get("member_id"));
	const companyId = String(formData.get("company_id"));
	await db
		.insert(clientCompanyMembers)
		.values({ memberId, companyId })
		.onConflictDoNothing();
	throw redirect(`/admin/companies/${companyId}`);
}, "linkMember");

export const unlinkMemberAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const memberId = String(formData.get("member_id"));
	const companyId = String(formData.get("company_id"));
	await db
		.delete(clientCompanyMembers)
		.where(
			and(
				eq(clientCompanyMembers.memberId, memberId),
				eq(clientCompanyMembers.companyId, companyId),
			),
		);
	throw redirect(`/admin/companies/${companyId}`);
}, "unlinkMember");

/** Redirect URL for Supabase invite/reset links (must be allowlisted in Supabase Auth settings). */
function inviteRedirect(): string | null {
	const site = process.env.PUBLIC_SITE_URL;
	return site ? `${site.replace(/\/$/, "")}/portal/login` : null;
}

export const resendInviteAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const id = String(formData.get("id"));
	const [member] = await db
		.select({ email: clientMembers.email })
		.from(clientMembers)
		.where(eq(clientMembers.id, id))
		.limit(1);
	if (!member) return { error: "Member not found" };

	const redirectTo = inviteRedirect();
	const { error } = await supabaseService().auth.admin.inviteUserByEmail(
		member.email,
		{ ...(redirectTo ? { redirectTo } : {}) },
	);
	if (error) return { error: error.message };
	return { success: "Invite re-sent." };
}, "resendInvite");

export const toggleMemberActiveAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const id = String(formData.get("id"));
	const isActive = formData.get("is_active") === "true";
	await db
		.update(clientMembers)
		.set({ isActive: !isActive })
		.where(eq(clientMembers.id, id));
	throw redirect("/admin/companies");
}, "toggleMemberActive");

// ── Projects (for select dropdowns) ───────────────────────────────

export const getProjectsForSelectQuery = query(async () => {
	"use server";
	await requireAdmin();
	return db
		.select({
			id: projects.id,
			name: projects.name,
			companyId: projects.companyId,
			companyName: companies.name,
		})
		.from(projects)
		.innerJoin(companies, eq(companies.id, projects.companyId))
		.orderBy(projects.name);
}, "admin-projects-select");

export const getCompaniesForSelectQuery = query(async () => {
	"use server";
	await requireAdmin();
	return db.select().from(companies).orderBy(companies.name);
}, "admin-companies-select");

// ── Documents ─────────────────────────────────────────────────────

export const getDocumentsQuery = query(async (projectId: string) => {
	"use server";
	await requireAdmin();
	return db
		.select()
		.from(documents)
		.where(eq(documents.projectId, projectId))
		.orderBy(desc(documents.createdAt));
}, "admin-documents");

export const createDocumentLinkAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	await db.insert(documents).values({
		projectId: String(formData.get("project_id")),
		type: String(formData.get("type") || "link") as DocumentType,
		title: String(formData.get("title")),
		url: String(formData.get("url")),
		description: String(formData.get("description") || ""),
		content: String(formData.get("content") || "") || null,
		visibility: "client",
	});
	const ref = formData.get("_referer");
	throw redirect(ref ? String(ref) : "/admin/companies");
}, "createDocumentLink");

export const deleteDocumentAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const id = String(formData.get("id"));
	const storagePath = String(formData.get("storage_path") || "");
	const audioPath = String(formData.get("audio_path") || "");
	const paths = [storagePath, audioPath].filter(Boolean);
	try {
		if (paths.length) {
			const svc = supabaseService();
			await svc.storage.from("portal-docs").remove(paths);
		}
		await db.delete(documents).where(eq(documents.id, id));
		return { success: "Document deleted." };
	} catch (e) {
		return { error: e instanceof Error ? e.message : "Failed to delete document." };
	}
}, "deleteDocument");

// ── Invoices ──────────────────────────────────────────────────────

export const getInvoicesQuery = query(async (projectId: string) => {
	"use server";
	await requireAdmin();
	return db
		.select()
		.from(invoices)
		.where(eq(invoices.projectId, projectId))
		.orderBy(desc(invoices.createdAt));
}, "admin-invoices");

export const createInvoiceAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	await db.insert(invoices).values({
		projectId: String(formData.get("project_id")),
		number: String(formData.get("number")),
		amount: Number(formData.get("amount")),
		status: String(formData.get("status") || "draft") as InvoiceStatus,
		issueDate: new Date(String(formData.get("issue_date"))),
		dueDate: formData.get("due_date")
			? new Date(String(formData.get("due_date")))
			: null,
		paymentUrl: formData.get("payment_url")
			? String(formData.get("payment_url"))
			: null,
		notes: String(formData.get("notes") || ""),
	});
	const ref = formData.get("_referer");
	throw redirect(ref ? String(ref) : "/admin/companies");
}, "createInvoice");

export const deleteInvoiceAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const id = String(formData.get("id"));
	const storagePath = String(formData.get("storage_path") || "");
	try {
		if (storagePath) {
			const svc = supabaseService();
			await svc.storage.from("portal-docs").remove([storagePath]);
		}
		await db.delete(invoices).where(eq(invoices.id, id));
		return { success: "Invoice deleted." };
	} catch (e) {
		return { error: e instanceof Error ? e.message : "Failed to delete invoice." };
	}
}, "deleteInvoice");

// ── Deliverables ──────────────────────────────────────────────────

export const getDeliverablesQuery = query(async (projectId: string) => {
	"use server";
	await requireAdmin();
	const delvs = await db
		.select()
		.from(deliverables)
		.where(eq(deliverables.projectId, projectId))
		.orderBy(deliverables.sortOrder);

	if (delvs.length === 0) return [];

	const allUpdates = await db
		.select()
		.from(deliverableUpdates)
		.where(
			inArray(
				deliverableUpdates.deliverableId,
				delvs.map((d) => d.id),
			),
		);

	const updatesByDeliverable = new Map<
		string,
		typeof deliverableUpdates.$inferSelect[]
	>();
	for (const u of allUpdates) {
		const arr = updatesByDeliverable.get(u.deliverableId) ?? [];
		arr.push(u);
		updatesByDeliverable.set(u.deliverableId, arr);
	}

	return delvs.map((d) => ({
		...d,
		updates: updatesByDeliverable.get(d.id) ?? [],
	}));
}, "admin-deliverables");

export const createDeliverableAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const projectId = String(formData.get("project_id"));
	const [last] = await db
		.select({ sortOrder: deliverables.sortOrder })
		.from(deliverables)
		.where(eq(deliverables.projectId, projectId))
		.orderBy(desc(deliverables.sortOrder))
		.limit(1);
	const nextOrder = (last?.sortOrder ?? -1) + 1;
	await db.insert(deliverables).values({
		projectId,
		title: String(formData.get("title")),
		description: String(formData.get("description") || ""),
		sortOrder: nextOrder,
	});
	const ref = formData.get("_referer");
	throw redirect(ref ? String(ref) : "/admin/projects");
}, "createDeliverable");

export const updateDeliverableStatusAction = action(
	async (formData: FormData) => {
		"use server";
		await requireAdmin();
		const id = String(formData.get("id"));
		const status = String(formData.get("status")) as DeliverableStatus;
		await db
			.update(deliverables)
			.set({ status, updatedAt: new Date() })
			.where(eq(deliverables.id, id));
		const ref = formData.get("_referer");
		throw redirect(ref ? String(ref) : "/admin/projects");
	},
	"updateDeliverableStatus",
);

export const addDeliverableUpdateAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const deliverableId = String(formData.get("deliverable_id"));
	const body = String(formData.get("body"));
	if (!body.trim()) return { error: "Update cannot be empty" };
	await db.insert(deliverableUpdates).values({ deliverableId, body });
	await db
		.update(deliverables)
		.set({ updatedAt: new Date() })
		.where(eq(deliverables.id, deliverableId));
	const ref = formData.get("_referer");
	throw redirect(ref ? String(ref) : "/admin/projects");
}, "addDeliverableUpdate");

export const deleteDeliverableAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const id = String(formData.get("id"));
	try {
		await db.delete(deliverables).where(eq(deliverables.id, id));
		return { success: "Deliverable deleted." };
	} catch (e) {
		return { error: e instanceof Error ? e.message : "Failed to delete deliverable." };
	}
}, "deleteDeliverable");
