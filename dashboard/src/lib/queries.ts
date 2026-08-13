import { query, action, redirect } from "@solidjs/router";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";
import { getCurrentUser, signIn } from "./session";
import { db } from "~/db";
import {
	projects,
	companies,
	timeEntries,
	deliverables,
	deliverableUpdates,
} from "~/db/schema";
import type { Project, EngagementType } from "~/db/schema";

// ── Auth ──────────────────────────────────────────────────────────

export const getUserQuery = query(async () => {
	"use server";
	return getCurrentUser();
}, "user");

export const loginAction = action(async (formData: FormData) => {
	"use server";
	const email = String(formData.get("email"));
	const password = String(formData.get("password"));
	const result = await signIn(email, password);
	if (result.error) return { error: result.error };
	throw redirect("/admin");
}, "login");

// ── Auth guard ────────────────────────────────────────────────────

async function requireAdmin() {
	const user = await getCurrentUser();
	if (!user) throw redirect("/admin/login");
}

// ── Projects ──────────────────────────────────────────────────────

export const getProjectsQuery = query(async () => {
	"use server";
	await requireAdmin();
	return db
		.select({
			...getTableColumns(projects),
			companyName: companies.name,
		})
		.from(projects)
		.innerJoin(companies, eq(companies.id, projects.companyId))
		.orderBy(desc(projects.createdAt));
}, "projects");

export const getProjectQuery = query(async (id: string) => {
	"use server";
	await requireAdmin();
	const [row] = await db
		.select({
			...getTableColumns(projects),
			companyName: companies.name,
		})
		.from(projects)
		.innerJoin(companies, eq(companies.id, projects.companyId))
		.where(eq(projects.id, id))
		.limit(1);
	if (!row) throw redirect("/admin/projects");
	return row;
}, "project");

export const createProjectAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const type = String(formData.get("engagement_type"));
	const proj: typeof projects.$inferInsert = {
		name: String(formData.get("name")),
		companyId: String(formData.get("company_id")),
		engagementType: type as EngagementType,
		hourlyRate: Number(formData.get("hourly_rate") || 0),
		fixedPrice: type === "project" ? Number(formData.get("fixed_price") || 0) : null,
		monthlyCapHours:
			type === "retainer" && formData.get("monthly_cap_hours")
				? Number(formData.get("monthly_cap_hours"))
				: null,
		status: "active",
		notes: String(formData.get("notes") || ""),
	};
	try {
		await db.insert(projects).values(proj);
	} catch (err) {
		return { error: err instanceof Error ? err.message : "Failed to create project." };
	}
	throw redirect("/admin/projects");
}, "createProject");

// ── Time entries ──────────────────────────────────────────────────

function monthRange() {
	const now = new Date();
	return {
		start: new Date(now.getFullYear(), now.getMonth(), 1),
		end: now,
	};
}

function weekRange() {
	const now = new Date();
	const day = now.getDay();
	const monday = new Date(now);
	monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
	return { start: monday, end: now };
}

export const getDashboardQuery = query(async () => {
	"use server";
	await requireAdmin();

	const week = weekRange();
	const month = monthRange();

	const [activeProjects, recentRows, weekRows, monthRows] = await Promise.all([
		db
			.select({ ...getTableColumns(projects), companyName: companies.name })
			.from(projects)
			.innerJoin(companies, eq(companies.id, projects.companyId))
			.where(eq(projects.status, "active"))
			.orderBy(desc(projects.createdAt)),
		db
			.select({
				...getTableColumns(timeEntries),
				projectName: projects.name,
				companyName: companies.name,
			})
			.from(timeEntries)
			.innerJoin(projects, eq(projects.id, timeEntries.projectId))
			.innerJoin(companies, eq(companies.id, projects.companyId))
			.orderBy(desc(timeEntries.entryDate))
			.limit(10),
		db
			.select({ hours: timeEntries.hours })
			.from(timeEntries)
			.where(and(gte(timeEntries.entryDate, week.start), lte(timeEntries.entryDate, week.end))),
		db
			.select({ hours: timeEntries.hours })
			.from(timeEntries)
			.where(and(gte(timeEntries.entryDate, month.start), lte(timeEntries.entryDate, month.end))),
	]);

	const weekTotal = weekRows.reduce((s, e) => s + e.hours, 0);
	const monthTotal = monthRows.reduce((s, e) => s + e.hours, 0);

	// Retainer cap usage for this month
	const retainerProjects = activeProjects.filter(
		(p) => p.engagementType === "retainer" && p.monthlyCapHours,
	);
	const caps = await Promise.all(
		retainerProjects.map(async (p) => {
			const rows = await db
				.select({ hours: timeEntries.hours })
				.from(timeEntries)
				.where(
					and(
						eq(timeEntries.projectId, p.id),
						gte(timeEntries.entryDate, month.start),
						lte(timeEntries.entryDate, month.end),
					),
				);
			return {
				project_id: p.id,
				project_name: p.name,
				cap: p.monthlyCapHours!,
				used: rows.reduce((s, e) => s + e.hours, 0),
			};
		}),
	);

	return {
		projects: activeProjects,
		weekTotal,
		monthTotal,
		entries: recentRows,
		caps,
	};
}, "dashboard");

export const getProjectEntriesQuery = query(async (projectId: string) => {
	"use server";
	await requireAdmin();
	return db
		.select()
		.from(timeEntries)
		.where(eq(timeEntries.projectId, projectId))
		.orderBy(desc(timeEntries.entryDate));
}, "project-entries");

function refererFromFormData(formData: FormData) {
	const ref = formData.get("_referer");
	if (ref) return String(ref);
	return "/";
}

export const createTimeEntryAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const projectId = String(formData.get("project_id"));
	const entry: typeof timeEntries.$inferInsert = {
		projectId,
		entryDate: new Date(String(formData.get("entry_date"))),
		hours: Number(formData.get("hours")),
		description: String(formData.get("description")),
		billable: formData.get("billable") === "on",
	};
	try {
		await db.insert(timeEntries).values(entry);
	} catch (err) {
		return { error: err instanceof Error ? err.message : "Failed to log time entry." };
	}
	throw redirect(refererFromFormData(formData));
}, "createTimeEntry");

export const deleteTimeEntryAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const id = String(formData.get("id"));
	await db.delete(timeEntries).where(eq(timeEntries.id, id));
	throw redirect(refererFromFormData(formData));
}, "deleteTimeEntry");
