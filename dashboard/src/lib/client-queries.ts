import { query, action, redirect } from "@solidjs/router";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";
import { getClient, clientSignIn } from "./client-session";
import { generateApiKey, hashKey, keyPrefix } from "./crypto";
import { db } from "~/db";
import {
	projects,
	companies,
	clientCompanyMembers,
	clientMembers,
	documents,
	invoices,
	deliverables,
	deliverableUpdates,
	apiKeys,
} from "~/db/schema";
import { sql } from "drizzle-orm";

// ── Client portal queries ──────────────────────────────────────────

export const getClientUserQuery = query(async () => {
	"use server";
	const member = await getClient();
	if (!member) throw redirect("/portal/login");
	return { id: member.id, name: member.name, email: member.email };
}, "client-user");

export const getClientDashboardQuery = query(async () => {
	"use server";
	const member = await getClient();
	if (!member) throw redirect("/portal/login");

	// All companies this member belongs to
	const memberCompanies = await db
		.select({ companyId: clientCompanyMembers.companyId })
		.from(clientCompanyMembers)
		.where(eq(clientCompanyMembers.memberId, member.id));

	const companyIds = memberCompanies.map((c) => c.companyId);
	if (companyIds.length === 0)
		return { projects: [], deliverables: [], docCount: 0, invoiceCount: 0 };

	// All projects across the member's companies
	const memberProjects = await db
		.select({
			...getTableColumns(projects),
			companyName: companies.name,
		})
		.from(projects)
		.innerJoin(companies, eq(companies.id, projects.companyId))
		.where(inArray(projects.companyId, companyIds))
		.orderBy(desc(projects.createdAt));

	const projectIds = memberProjects.map((p) => p.id);

	// Deliverables across all projects
	const allDeliverables =
		projectIds.length > 0
			? await db
					.select()
					.from(deliverables)
					.where(inArray(deliverables.projectId, projectIds))
					.orderBy(deliverables.sortOrder)
			: [];

	const delvIds = allDeliverables.map((d) => d.id);
	const allUpdates =
		delvIds.length > 0
			? await db
					.select()
					.from(deliverableUpdates)
					.where(inArray(deliverableUpdates.deliverableId, delvIds))
			: [];

	const updatesByDeliverable = new Map<
		string,
		typeof deliverableUpdates.$inferSelect[]
	>();
	for (const u of allUpdates) {
		const arr = updatesByDeliverable.get(u.deliverableId) ?? [];
		arr.push(u);
		updatesByDeliverable.set(u.deliverableId, arr);
	}

	const deliverablesWithUpdates = allDeliverables.map((d) => ({
		...d,
		updates: updatesByDeliverable.get(d.id) ?? [],
	}));

	// Doc + invoice counts
	const docRows =
		projectIds.length > 0
			? await db
					.select({ id: documents.id })
					.from(documents)
					.where(
						and(
							inArray(documents.projectId, projectIds),
							eq(documents.visibility, "client"),
						),
					)
			: [];

	const invoiceRows =
		projectIds.length > 0
			? await db
					.select({ id: invoices.id })
					.from(invoices)
					.where(
						and(
							inArray(invoices.projectId, projectIds),
							inArray(invoices.status, ["sent", "draft"]),
						),
					)
			: [];

	return {
		projects: memberProjects,
		deliverables: deliverablesWithUpdates,
		docCount: docRows.length,
		invoiceCount: invoiceRows.length,
	};
}, "client-dashboard");

export const getClientDocumentsQuery = query(async () => {
	"use server";
	const member = await getClient();
	if (!member) throw redirect("/portal/login");

	const memberCompanies = await db
		.select({ companyId: clientCompanyMembers.companyId })
		.from(clientCompanyMembers)
		.where(eq(clientCompanyMembers.memberId, member.id));

	const companyIds = memberCompanies.map((c) => c.companyId);
	if (companyIds.length === 0) return [];

	const memberProjects = await db
		.select({ id: projects.id })
		.from(projects)
		.where(inArray(projects.companyId, companyIds));

	const projectIds = memberProjects.map((p) => p.id);
	if (projectIds.length === 0) return [];

	return db
		.select()
		.from(documents)
		.where(
			and(
				inArray(documents.projectId, projectIds),
				eq(documents.visibility, "client"),
			),
		)
		.orderBy(desc(documents.createdAt));
}, "client-documents");

export const getClientInvoicesQuery = query(async () => {
	"use server";
	const member = await getClient();
	if (!member) throw redirect("/portal/login");

	const memberCompanies = await db
		.select({ companyId: clientCompanyMembers.companyId })
		.from(clientCompanyMembers)
		.where(eq(clientCompanyMembers.memberId, member.id));

	const companyIds = memberCompanies.map((c) => c.companyId);
	if (companyIds.length === 0) return [];

	const memberProjects = await db
		.select({ id: projects.id })
		.from(projects)
		.where(inArray(projects.companyId, companyIds));

	const projectIds = memberProjects.map((p) => p.id);
	if (projectIds.length === 0) return [];

	return db
		.select()
		.from(invoices)
		.where(inArray(invoices.projectId, projectIds))
		.orderBy(desc(invoices.createdAt));
}, "client-invoices");

export const getClientApiKeysQuery = query(async () => {
	"use server";
	const member = await getClient();
	if (!member) throw redirect("/portal/login");
	return db
		.select({
			id: apiKeys.id,
			memberId: apiKeys.memberId,
			label: apiKeys.label,
			keyPrefix: apiKeys.keyPrefix,
			lastUsedAt: apiKeys.lastUsedAt,
			revokedAt: apiKeys.revokedAt,
			createdAt: apiKeys.createdAt,
		})
		.from(apiKeys)
		.where(eq(apiKeys.memberId, member.id))
		.orderBy(desc(apiKeys.createdAt));
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
	const member = await getClient();
	if (!member) throw redirect("/portal/login");
	const label = String(formData.get("label") || "Default");
	const rawKey = generateApiKey();
	await db.insert(apiKeys).values({
		memberId: member.id,
		label,
		keyHash: hashKey(rawKey),
		keyPrefix: keyPrefix(rawKey),
	});
	return { key: rawKey };
}, "createApiKey");

export const revokeApiKeyAction = action(async (formData: FormData) => {
	"use server";
	const member = await getClient();
	if (!member) throw redirect("/portal/login");
	const id = String(formData.get("id"));
	await db
		.update(apiKeys)
		.set({ revokedAt: new Date() })
		.where(and(eq(apiKeys.id, id), eq(apiKeys.memberId, member.id)));
	throw redirect("/portal/api-keys");
}, "revokeApiKey");
