import { query, action, redirect } from "@solidjs/router";
import { getCurrentUser, getAuthedClient, signIn } from "./session";
import type { EntryWithProject, Project, TimeEntry } from "./supabase";

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

// ── Projects ──────────────────────────────────────────────────────

export const getProjectsQuery = query(async () => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
	const { data, error } = await supabase
		.from("projects")
		.select("*")
		.order("created_at", { ascending: false });
	if (error) throw error;
	return data as Project[];
}, "projects");

export const getProjectQuery = query(async (id: string) => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
	const { data, error } = await supabase
		.from("projects")
		.select("*")
		.eq("id", id)
		.single();
	if (error) throw error;
	return data as Project;
}, "project");

export const createProjectAction = action(async (formData: FormData) => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
	const cap = formData.get("monthly_cap_hours");
	const { error } = await supabase.from("projects").insert({
		name: String(formData.get("name")),
		client_name: String(formData.get("client_name")),
		engagement_type: String(formData.get("engagement_type")),
		hourly_rate: Number(formData.get("hourly_rate")),
		monthly_cap_hours: cap ? Number(cap) : null,
		status: "active",
		notes: String(formData.get("notes") || ""),
	});
	if (error) return { error: error.message };
	throw redirect("/admin/projects");
}, "createProject");

// ── Time entries ──────────────────────────────────────────────────

function monthRange() {
	const now = new Date();
	const start = new Date(now.getFullYear(), now.getMonth(), 1);
	return {
		start: start.toISOString().slice(0, 10),
		end: now.toISOString().slice(0, 10),
	};
}

function weekRange() {
	const now = new Date();
	const day = now.getDay();
	const monday = new Date(now);
	monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
	return {
		start: monday.toISOString().slice(0, 10),
		end: now.toISOString().slice(0, 10),
	};
}

export const getDashboardQuery = query(async () => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");

	const projects = await supabase
		.from("projects")
		.select("*")
		.eq("status", "active")
		.order("created_at", { ascending: false });

	const week = weekRange();
	const month = monthRange();

	const [recent, weekHours, monthHours] = await Promise.all([
		supabase
			.from("time_entries")
			.select("*, project:projects(name, client_name)")
			.order("entry_date", { ascending: false })
			.limit(10),
		supabase
			.from("time_entries")
			.select("hours")
			.gte("entry_date", week.start)
			.lte("entry_date", week.end),
		supabase
			.from("time_entries")
			.select("hours")
			.gte("entry_date", month.start)
			.lte("entry_date", month.end),
	]);

	const weekTotal = (weekHours.data ?? []).reduce((s, e) => s + e.hours, 0);
	const monthTotal = (monthHours.data ?? []).reduce((s, e) => s + e.hours, 0);

	const retainerProjects = (projects.data ?? []).filter(
		(p) => p.engagement_type === "retainer" && p.monthly_cap_hours,
	);
	const caps = await Promise.all(
		retainerProjects.map(async (p) => {
			const { data } = await supabase
				.from("time_entries")
				.select("hours")
				.eq("project_id", p.id)
				.gte("entry_date", month.start)
				.lte("entry_date", month.end);
			const used = (data ?? []).reduce((s, e) => s + e.hours, 0);
			return {
				project_id: p.id,
				project_name: p.name,
				cap: p.monthly_cap_hours!,
				used,
			};
		}),
	);

	const entries: EntryWithProject[] = (recent.data ?? []).map((e) => ({
		...e,
		project_name: (e.project as { name: string }).name,
		client_name: (e.project as { client_name: string }).client_name,
	}));

	return {
		projects: projects.data ?? [],
		weekTotal,
		monthTotal,
		entries,
		caps,
	};
}, "dashboard");

export const getProjectEntriesQuery = query(async (projectId: string) => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
	const { data, error } = await supabase
		.from("time_entries")
		.select("*")
		.eq("project_id", projectId)
		.order("entry_date", { ascending: false });
	if (error) throw error;
	return data as TimeEntry[];
}, "project-entries");

function refererFromFormData(formData: FormData) {
	const ref = formData.get("_referer");
	if (ref) return String(ref);
	return "/";
}

export const createTimeEntryAction = action(async (formData: FormData) => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
	const projectId = String(formData.get("project_id"));
	const { error } = await supabase.from("time_entries").insert({
		project_id: projectId,
		entry_date: String(formData.get("entry_date")),
		hours: Number(formData.get("hours")),
		description: String(formData.get("description")),
		billable: formData.get("billable") === "on",
	});
	if (error) return { error: error.message };
	throw redirect(refererFromFormData(formData));
}, "createTimeEntry");

export const deleteTimeEntryAction = action(async (formData: FormData) => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
	const id = String(formData.get("id"));
	const { error } = await supabase.from("time_entries").delete().eq("id", id);
	if (error) return { error: error.message };
	throw redirect(refererFromFormData(formData));
}, "deleteTimeEntry");
