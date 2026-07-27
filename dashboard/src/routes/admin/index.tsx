import { Title } from "@solidjs/meta";
import { A, createAsync, useAction } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import Layout from "~/components/Layout";
import {
	createTimeEntryAction,
	getDashboardQuery,
	getUserQuery,
} from "~/lib/queries";

export default function Home() {
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const data = createAsync(() => getDashboardQuery(), { deferStream: true });
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
				<Show when={data()}>
					{(d) => (
						<>
							{/* Stats */}
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
											const pct = Math.min(
												(cap.used / cap.cap) * 100,
												100,
											);
											const cls =
												pct >= 100 ? "over" : pct >= 80 ? "warn" : "";
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
														<span style={{ "font-size": "14px" }}>
															{cap.project_name}
														</span>
														<span class="mono" style={{ "font-size": "13px" }}>
															{cap.used} / {cap.cap} hrs
														</span>
													</div>
													<div class="progress">
														<div
															class={`progress-fill ${cls}`}
															style={{ width: `${pct}%` }}
														/>
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
															{p.name} — {p.client_name}
														</option>
													)}
												</For>
											</select>
										</div>
										<div class="form-group">
											<label for="entry_date">Date</label>
											<input
												type="date"
												id="entry_date"
												name="entry_date"
												value={today}
												required
											/>
										</div>
									</div>
									<div class="form-row">
										<div class="form-group">
											<label for="hours">Hours</label>
											<input
												type="number"
												id="hours"
												name="hours"
												step="0.25"
												min="0.25"
												placeholder="2.5"
												required
											/>
										</div>
										<div class="form-group">
											<label for="billable">Billable</label>
											<div
												style={{
													display: "flex",
													"align-items": "center",
													gap: "8px",
													padding: "12px 0",
												}}
											>
												<input
													type="checkbox"
													id="billable"
													name="billable"
													checked
													style={{ width: "auto" }}
												/>
												<span class="muted" style={{ "font-size": "14px" }}>
													Charge client
												</span>
											</div>
										</div>
									</div>
									<div class="form-group">
										<label for="description">What did you do?</label>
										<textarea
											id="description"
											name="description"
											rows={2}
											placeholder="Built agent routing logic, reviewed PRs, deployed v2 config…"
											required
										/>
									</div>
									<Show when={entryError()}>
										<p class="login-error" style={{ "margin-bottom": "12px" }}>
											{entryError()}
										</p>
									</Show>
									<button type="submit" class="btn btn-primary">
										Log Entry
									</button>
								</form>
							</div>

							{/* Recent entries */}
							<div class="section-heading">Recent Entries</div>
							<Show
								when={d().entries.length > 0}
								fallback={<p class="empty">No entries yet.</p>}
							>
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
														{new Date(e.entry_date).toLocaleDateString(
															"en-US",
															{ month: "short", day: "numeric" },
														)}
													</td>
													<td>
														<A
															href={`/admin/projects/${e.project_id}`}
															class="gold"
														>
															{e.project_name}
														</A>
													</td>
													<td>{e.description}</td>
													<td class="hours" style={{ "text-align": "right" }}>
														{e.hours}
													</td>
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
