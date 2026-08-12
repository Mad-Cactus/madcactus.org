import { Title } from "@solidjs/meta";
import { A, createAsync, useAction } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import Layout from "~/components/Layout";
import {
	createTimeEntryAction,
	getDashboardQuery,
	getUserQuery,
} from "~/lib/queries";
import {
	DELIVERABLE_STATUS_META,
	getOverviewQuery,
	type ExternalResult,
} from "~/lib/overview";

/** Render an external-source metric, degrading to a muted "not connected" tile. */
function SourceTile(props: {
	label: string;
	result: ExternalResult<Record<string, number>> | undefined;
	value: (d: any) => string;
	sub?: (d: any) => string;
}) {
	// Precompute display state so the discriminated-union narrowing stays simple.
	const r = props.result;
	const isError = !!r && !r.ok && r.reason === "error";
	const isOk = !!r && r.ok;
	return (
		<div class="stat-card">
			<div class="label">{props.label}</div>
			<Show
				when={isOk}
				fallback={
					<Show
						when={isError}
						fallback={
							<div class="value value-muted">
								—
								<div class="sub">Not connected</div>
							</div>
						}
					>
						<div class="value value-error">
							—
							<div class="sub sub-error">Unavailable</div>
						</div>
					</Show>
				}
			>
				<div class="value">
					{props.value((r as any).data)}
					<Show when={props.sub}>
						<div class="sub">{props.sub!((r as any).data)}</div>
					</Show>
				</div>
			</Show>
		</div>
	);
}

export default function Home() {
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const data = createAsync(() => getDashboardQuery(), { deferStream: true });
	const overview = createAsync(() => getOverviewQuery(), { deferStream: true });
	const createEntry = useAction(createTimeEntryAction);
	const [entryError, setEntryError] = createSignal("");

	const today = new Date().toISOString().slice(0, 10);

	async function handleLog(e: Event) {
		e.preventDefault();
		setEntryError("");
		const form = e.target as HTMLFormElement;
		const fd = new FormData(form);
		fd.set("_referer", "/admin");
		const result = await createEntry(fd);
		if (result?.error) setEntryError(result.error);
		else form.reset();
	}

	return (
		<Layout user={user()}>
			<Title>Dashboard — Mad Cactus</Title>
			<h1 class="page-title">Dashboard</h1>
			<p class="page-subtitle">
				{new Date().toLocaleDateString("en-US", {
					weekday: "long",
					month: "long",
					day: "numeric",
				})}
			</p>

			<Suspense fallback={<p class="muted">Loading…</p>}>
				<Show when={overview()}>
					{(ov) => (
						<>
							{/* ── Metric tiles — the single pane of glass ── */}
							<div class="stat-grid">
								<SourceTile
									label="Page Views (30d)"
									result={ov().external.posthog as any}
									value={(d) => fmt(d.pageviews30d)}
									sub={(d) => `${fmt(d.pageviews7d)} this week · ${fmt(d.uniqueUsers30d)} unique`}
								/>
								<SourceTile
									label="Newsletter Leads"
									result={ov().external.resend as any}
									value={(d) => fmt(d.subscribers) + (d.overflow ? "+" : "")}
									sub={() => "subscribers"}
								/>
								<SourceTile
									label="Open Issues"
									result={ov().external.linear as any}
									value={(d) => fmt(d.openIssues)}
									sub={() => "assigned to you"}
								/>
								<div class="stat-card">
									<div class="label">Active Contracts</div>
									<div class="value">
										{ov().companies.total}
									</div>
									<div class="sub">
										{ov().companies.total} compan{ov().companies.total === 1 ? "y" : "ies"} · {ov().deliverables.total} deliverable{ov().deliverables.total === 1 ? "" : "s"}
									</div>
								</div>
							</div>

							{/* Sources not yet wired — muted placeholders */}
							<div class="stat-grid stat-grid-muted">
								<div class="stat-card stat-card-placeholder">
									<div class="label">Bank Account (Novo)</div>
									<div class="value value-muted">
										—
										<div class="sub">Needs Plaid</div>
									</div>
								</div>
								<div class="stat-card stat-card-placeholder">
									<div class="label">Google Workspace</div>
									<div class="value value-muted">
										—
										<div class="sub">Not connected</div>
									</div>
								</div>
								<div class="stat-card stat-card-placeholder">
									<div class="label">Gmail</div>
									<div class="value value-muted">
										—
										<div class="sub">Not connected</div>
									</div>
								</div>
							</div>

							{/* ── Work needing attention ── */}
							<Show when={ov().deliverables.attention.length > 0}>
								<div class="section-heading">Needs Attention</div>
								<table class="table">
									<thead>
										<tr>
											<th>Deliverable</th>
											<th>Project</th>
											<th>Status</th>
										</tr>
									</thead>
									<tbody>
										<For each={ov().deliverables.attention}>
											{(d) => (
												<tr>
													<td>
														<A href={`/admin/projects/${d.project_id}`} class="gold">
															{d.title}
														</A>
													</td>
													<td class="muted">{d.projectName}</td>
													<td>
														<span class={`badge ${DELIVERABLE_STATUS_META[d.status].cls}`}>
															{DELIVERABLE_STATUS_META[d.status].label}
														</span>
													</td>
												</tr>
											)}
										</For>
									</tbody>
								</table>
							</Show>

							{/* ── Outstanding invoices ── */}
							<Show when={ov().invoices.outstanding.length > 0}>
								<div class="section-heading">
									Outstanding Invoices
									<span class="section-aside">
										${ov().invoices.outstandingTotal.toFixed(2)} unpaid
									</span>
								</div>
								<table class="table">
									<thead>
										<tr>
											<th>Invoice</th>
											<th>Project</th>
											<th style={{ "text-align": "right" }}>Amount</th>
											<th>Due</th>
											<th>Status</th>
										</tr>
									</thead>
									<tbody>
										<For each={ov().invoices.outstanding.slice(0, 6)}>
											{(inv) => (
												<tr>
													<td>{inv.number}</td>
													<td class="muted">{inv.projectName}</td>
													<td class="hours" style={{ "text-align": "right" }}>
														${Number(inv.amount).toFixed(2)}
													</td>
													<td class="muted">
														{inv.due_date
															? new Date(inv.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
															: "—"}
													</td>
													<td>
														<span class={`badge ${inv.status === "sent" ? "badge-paused" : "badge-completed"}`}>
															{inv.status}
														</span>
													</td>
												</tr>
											)}
										</For>
									</tbody>
								</table>
							</Show>

							{/* ── Open Linear issues (when connected) ── */}
							<Show when={ov().external.linear.ok}>
								<div class="section-heading">Open Issues</div>
								<table class="table">
									<tbody>
										<For each={(ov().external.linear as any).data.issues}>
											{(issue) => (
												<tr>
													<td class="mono" style={{ "white-space": "nowrap" }}>{issue.identifier}</td>
													<td>{issue.title}</td>
													<td class="muted" style={{ "text-align": "right" }}>{issue.state}</td>
												</tr>
											)}
										</For>
									</tbody>
								</table>
							</Show>
						</>
					)}
				</Show>

				{/* ── Hours / time tracking (owned data) ── */}
				<Show when={data()}>
					{(d) => (
						<>
							<div class="stat-grid">
								<div class="stat-card">
									<div class="label">This Week</div>
									<div class="value">
										{d().weekTotal}
										<span class="unit"> hrs</span>
									</div>
								</div>
								<div class="stat-card">
									<div class="label">This Month</div>
									<div class="value">
										{d().monthTotal}
										<span class="unit"> hrs</span>
									</div>
								</div>
								<div class="stat-card">
									<div class="label">Active Projects</div>
									<div class="value">{d().projects.length}</div>
								</div>
							</div>

							{/* Retainer caps */}
							<Show when={d().caps.length > 0}>
								<div class="section-heading">Monthly Retainer Caps</div>
								<div class="card">
									<For each={d().caps}>
										{(cap) => {
											const pct = Math.min((cap.used / cap.cap) * 100, 100);
											const cls = pct >= 100 ? "over" : pct >= 80 ? "warn" : "";
											return (
												<div style={{ "margin-bottom": "20px" }}>
													<div
														style={{
															display: "flex",
															"justify-content": "space-between",
															"align-items": "center",
															"margin-bottom": "4px",
														}}
													>
														<span style={{ "font-size": "14px" }}>{cap.project_name}</span>
														<span class="mono" style={{ "font-size": "13px" }}>
															{cap.used} / {cap.cap} hrs
														</span>
													</div>
													<div class="progress">
														<div class={`progress-fill ${cls}`} style={{ width: `${pct}%` }} />
													</div>
												</div>
											);
										}}
									</For>
								</div>
							</Show>

							{/* Quick log */}
							<div class="section-heading">Log Time</div>
							<div class="card">
								<form onSubmit={handleLog}>
									<div class="form-row">
										<div class="form-group">
											<label for="project_id">Project</label>
											<select id="project_id" name="project_id" required>
												<For each={d().projects}>
													{(p) => (
														<option value={p.id}>
															{p.name} — {p.companyName}
														</option>
													)}
												</For>
											</select>
										</div>
										<div class="form-group">
											<label for="entry_date">Date</label>
											<input type="date" id="entry_date" name="entry_date" value={today} required />
										</div>
									</div>
									<div class="form-row">
										<div class="form-group">
											<label for="hours">Hours</label>
											<input type="number" id="hours" name="hours" step="0.25" min="0.25" placeholder="2.5" required />
										</div>
										<div class="form-group">
											<label for="billable">Billable</label>
											<div style={{ display: "flex", "align-items": "center", gap: "8px", padding: "12px 0" }}>
												<input type="checkbox" id="billable" name="billable" checked style={{ width: "auto" }} />
												<span class="muted" style={{ "font-size": "14px" }}>Charge client</span>
											</div>
										</div>
									</div>
									<div class="form-group">
										<label for="description">What did you do?</label>
										<textarea id="description" name="description" rows={2} placeholder="Built agent routing logic, reviewed PRs, deployed v2 config…" required />
									</div>
									<Show when={entryError()}>
										<p class="login-error" style={{ "margin-bottom": "12px" }}>{entryError()}</p>
									</Show>
									<button type="submit" class="btn btn-primary">Log Entry</button>
								</form>
							</div>

							{/* Recent entries */}
							<div class="section-heading">Recent Entries</div>
							<Show when={d().entries.length > 0} fallback={<p class="empty">No entries yet.</p>}>
								<table class="table">
									<thead>
										<tr>
											<th>Date</th>
											<th>Project</th>
											<th>Description</th>
											<th style={{ "text-align": "right" }}>Hours</th>
										</tr>
									</thead>
									<tbody>
										<For each={d().entries}>
											{(e) => (
												<tr>
													<td class="muted">
														{new Date(e.entry_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
													</td>
													<td>
														<A href={`/admin/projects/${e.projectId}`} class="gold">{e.projectName}</A>
													</td>
													<td>{e.description}</td>
													<td class="hours" style={{ "text-align": "right" }}>{e.hours}</td>
												</tr>
											)}
										</For>
									</tbody>
								</table>
							</Show>
						</>
					)}
				</Show>
			</Suspense>
		</Layout>
	);
}

function fmt(n: number): string {
	if (n == null || Number.isNaN(n)) return "0";
	return n >= 1000 ? n.toLocaleString("en-US") : String(n);
}
