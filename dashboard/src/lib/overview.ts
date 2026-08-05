import { query, redirect } from "@solidjs/router";
import { Resend } from "resend";
import { getAuthedClient } from "./session";
import type { Deliverable, DeliverableStatus, Invoice } from "./supabase";

/**
 * Single-pane-of-glass overview.
 *
 * Aggregates data the business already owns (Supabase) with three external
 * sources surfaced when their API keys are present: Resend (newsletter leads),
 * PostHog (page views), and Linear (open issues). Each external source is
 * isolated in try/catch with a 5s timeout so one slow/unconfigured service can
 * never break the page — it degrades to a "not connected / error" tile.
 */

// ── External fetchers ──────────────────────────────────────────────

const FETCH_TIMEOUT = 5000;

export type ExternalResult<T> =
	| { ok: true; data: T }
	| { ok: false; reason: "not_configured" | "error"; message?: string };

function notConfigured<T>(): ExternalResult<T> {
	return { ok: false, reason: "not_configured" };
}

/** Resend — newsletter subscriber (lead) count. */
async function resendLeads(): Promise<ExternalResult<{ subscribers: number; overflow?: boolean }>> {
	const key = process.env.RESEND_API_KEY;
	if (!key) return notConfigured();
	try {
		const resend = new Resend(key);
		const { data, error } = await resend.contacts.list({ limit: 100 });
		if (error) return { ok: false, reason: "error", message: error.message };
		const count = data?.data?.length ?? 0;
		// ponytail: contacts.list caps at 100/page; newsletter volume is low so we
		// surface the page count and flag overflow. Upgrade: paginate with `after`.
		return { ok: true, data: { subscribers: count, overflow: data?.has_more } };
	} catch (e) {
		return { ok: false, reason: "error", message: errMsg(e) };
	}
}

/** PostHog — page views + unique visitors over the last 30 days. */
async function posthogStats(): Promise<
	ExternalResult<{ pageviews30d: number; uniqueUsers30d: number; pageviews7d: number }>
> {
	const host = process.env.POSTHOG_HOST;
	const key = process.env.POSTHOG_PERSONAL_KEY;
	if (!host || !key) return notConfigured();
	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${key}`,
		};
		// 1. resolve the numeric project id
		const projRes = await fetch(`${host}/api/projects/?limit=1`, {
			headers,
			signal: AbortSignal.timeout(FETCH_TIMEOUT),
		});
		if (!projRes.ok) throw new Error(`projects ${projRes.status}`);
		const projJson = await projRes.json();
		const projectId = projJson.results?.[0]?.id;
		if (projectId == null) throw new Error("no posthog project found");

		// 2. HogQL: 30d + 7d pageviews and unique visitors in one shot
		const qRes = await fetch(`${host}/api/projects/${projectId}/query/`, {
			method: "POST",
			headers,
			signal: AbortSignal.timeout(FETCH_TIMEOUT),
			body: JSON.stringify({
				query: {
					kind: "HogQLQuery",
					name: "spog-pageviews-30d",
					query:
						"select count() as pv30, count(DISTINCT distinct_id) as uniques, " +
						"countIf(timestamp > now() - interval 7 day) as pv7 " +
						"from events where event = '$pageview' and timestamp > now() - interval 30 day",
				},
			}),
		});
		if (!qRes.ok) throw new Error(`query ${qRes.status}`);
		const qJson = await qRes.json();
		const row = qJson.results?.[0] ?? [];
		return {
			ok: true,
			data: {
				pageviews30d: Number(row[0] ?? 0),
				uniqueUsers30d: Number(row[1] ?? 0),
				pageviews7d: Number(row[2] ?? 0),
			},
		};
	} catch (e) {
		return { ok: false, reason: "error", message: errMsg(e) };
	}
}

/** Linear — open issues assigned to me. */
async function linearIssues(): Promise<
	ExternalResult<{
		openIssues: number;
		issues: { id: string; identifier: string; title: string; state: string; priority: number }[];
	}>
> {
	const key = process.env.LINEAR_API_KEY;
	if (!key) return notConfigured();
	try {
		const res = await fetch("https://api.linear.app/graphql", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				// Linear personal API key: raw value, no "Bearer" prefix.
				Authorization: key,
			},
			signal: AbortSignal.timeout(FETCH_TIMEOUT),
			body: JSON.stringify({
				query:
					`{ issues(filter: { assignee: { isMe: { eq: true } }, ` +
					`state: { type: { neq: completed } } }, orderBy: updatedAt) ` +
					`{ nodes { id identifier title priority state { name } } } }`,
			}),
		});
		if (!res.ok) throw new Error(`http ${res.status}`);
		const json: any = await res.json();
		if (json.errors?.length) throw new Error(json.errors[0].message);
		const nodes: any[] = json.data?.issues?.nodes ?? [];
		return {
			ok: true,
			data: {
				openIssues: nodes.length,
				issues: nodes.slice(0, 8).map((n) => ({
					id: n.id,
					identifier: n.identifier,
					title: n.title,
					state: n.state?.name ?? "—",
					priority: n.priority,
				})),
			},
		};
	} catch (e) {
		return { ok: false, reason: "error", message: errMsg(e) };
	}
}

function errMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

// ── DB aggregates (cross-project, not in queries.ts) ───────────────

export interface DeliverableWithProject extends Deliverable {
	project_name: string;
	client_name: string;
	project_status: string;
}

export interface OverviewData {
	deliverables: {
		total: number;
		inProgress: number;
		blocked: number;
		review: number;
		attention: DeliverableWithProject[]; // blocked / review / in_progress across active projects
	};
	invoices: {
		outstanding: (Invoice & { project_name: string })[];
		outstandingTotal: number;
	};
	clients: {
		total: number;
		active: number;
	};
	external: {
		posthog: ExternalResult<{
			pageviews30d: number;
			uniqueUsers30d: number;
			pageviews7d: number;
		}>;
		resend: ExternalResult<{ subscribers: number; overflow?: boolean }>;
		linear: ExternalResult<{
			openIssues: number;
			issues: { id: string; identifier: string; title: string; state: string; priority: number }[];
		}>;
	};
}

export const DELIVERABLE_STATUS_META: Record<
	DeliverableStatus,
	{ label: string; cls: string }
> = {
	planned: { label: "Planned", cls: "badge-completed" },
	in_progress: { label: "In Progress", cls: "" },
	review: { label: "In Review", cls: "badge-paused" },
	completed: { label: "Completed", cls: "badge-completed" },
	blocked: { label: "Blocked", cls: "badge-over" },
};

export const getOverviewQuery = query(async (): Promise<OverviewData> => {
	"use server";
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");

	// DB aggregates + external calls run concurrently; external failures are isolated.
	const [delivRes, invRes, clientRes, posthog, resend, linear] = await Promise.all([
		supabase
			.from("deliverables")
			.select("*, project:projects(name, client_name, status)")
			.order("updated_at", { ascending: false }),
		supabase
			.from("invoices")
			.select("*, project:projects(name)")
			.in("status", ["sent", "draft"])
			.order("due_date", { ascending: true }),
		supabase.from("clients").select("id, is_active"),
		posthogStats(),
		resendLeads(),
		linearIssues(),
	]);

	const deliverables: DeliverableWithProject[] = ((delivRes.data ?? []) as any[])
		.filter((d) => (d.project as any)?.status === "active")
		.map((d) => ({
			...d,
			project_name: (d.project as any)?.name ?? "—",
			client_name: (d.project as any)?.client_name ?? "—",
			project_status: (d.project as any)?.status ?? "active",
		}));

	const statusCount = (s: DeliverableStatus) =>
		deliverables.filter((d) => d.status === s).length;

	const attention = deliverables
		.filter((d) => ["blocked", "review", "in_progress"].includes(d.status))
		.slice(0, 8);

	const outstanding = (invRes.data ?? []).map((i) => ({
		...i,
		project_name: (i as any).project?.name ?? "—",
	}));
	const outstandingTotal = outstanding
		.filter((i) => i.status === "sent")
		.reduce((s, i) => s + Number(i.amount), 0);

	const clientRows = clientRes.data ?? [];

	return {
		deliverables: {
			total: deliverables.length,
			inProgress: statusCount("in_progress"),
			blocked: statusCount("blocked"),
			review: statusCount("review"),
			attention,
		},
		invoices: { outstanding, outstandingTotal },
		clients: {
			total: clientRows.length,
			active: clientRows.filter((c) => c.is_active).length,
		},
		external: { posthog, resend, linear },
	};
}, "overview");

// re-export removed: ExternalResult is already exported at its declaration above
