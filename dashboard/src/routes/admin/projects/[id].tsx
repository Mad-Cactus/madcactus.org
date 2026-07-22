import { Title } from "@solidjs/meta";
import { A, useNavigate, useParams, createAsync, useAction } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import Layout from "~/components/Layout";
import {
	createTimeEntryAction,
	deleteTimeEntryAction,
	getProjectEntriesQuery,
	getProjectQuery,
	getUserQuery,
} from "~/lib/queries";

export default function ProjectDetail() {
	const params = useParams();
	const navigate = useNavigate();
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const project = createAsync(() => getProjectQuery(params.id!), { deferStream: true });
	const entries = createAsync(() => getProjectEntriesQuery(params.id!), { deferStream: true });
	const createEntry = useAction(createTimeEntryAction);
	const deleteEntry = useAction(deleteTimeEntryAction);
	const [error, setError] = createSignal("");

	const today = new Date().toISOString().slice(0, 10);
	const totalHours = () =>
		(entries() ?? []).reduce((sum, e) => sum + e.hours, 0);

	async function handleLog(e: Event) {
		e.preventDefault();
		setError("");
		const form = e.target as HTMLFormElement;
		const fd = new FormData(form);
		fd.set("_referer", `/admin/projects/${params.id}`);
		const result = await createEntry(fd);
		if (result?.error) setError(result.error);
		else form.reset();
	}

	async function handleDelete(id: string) {
		const fd = new FormData();
		fd.set("id", id);
		fd.set("_referer", `/admin/projects/${params.id}`);
		await deleteEntry(fd);
	}

	return (
		<Layout user={user()}>
			<Suspense fallback={<p class="muted">Loading…</p>}>
				<Show when={project()} fallback={<p class="muted">Loading…</p>}>
					{(p) => (
						<>
							<Title>{p().name} — Mad Cactus</Title>
							<A href="/admin/projects" class="muted" style={{ "font-size": "13px", "margin-bottom": "8px", display: "inline-block" }}>
								← All Projects
							</A>
							<h1 class="page-title">{p().name}</h1>
							<p class="page-subtitle">
								{p().client_name} · <span style={{ "text-transform": "capitalize" }}>{p().engagement_type}</span> · ${p().hourly_rate}/hr
								{p().monthly_cap_hours ? ` · ${p().monthly_cap_hours}h cap` : ""}
							</p>

							<Show when={p().notes}>
								<div class="card" style={{ "margin-bottom": "32px" }}>
									<div class="section-heading" style={{ "margin-top": "0" }}>Scope</div>
									<p class="muted" style={{ "white-space": "pre-wrap" }}>{p().notes}</p>
								</div>
							</Show>

							{/* Log form */}
							<div class="section-heading">Log Time</div>
							<div class="card" style={{ "margin-bottom": "32px" }}>
								<form onSubmit={handleLog}>
									<input type="hidden" name="project_id" value={p().id} />
									<div class="form-row">
										<div class="form-group">
											<label for="entry_date">Date</label>
											<input type="date" id="entry_date" name="entry_date" value={today} required />
										</div>
										<div class="form-group">
											<label for="hours">Hours</label>
											<input type="number" id="hours" name="hours" step="0.25" min="0.25" placeholder="2.5" required />
										</div>
									</div>
									<div class="form-group">
										<label for="description">What did you do?</label>
										<textarea id="description" name="description" rows={2} required placeholder="What was accomplished…" />
									</div>
									<div class="form-group">
										<label style={{ display: "flex", "align-items": "center", gap: "8px", cursor: "pointer" }}>
											<input type="checkbox" name="billable" checked style={{ width: "auto" }} />
											Billable
										</label>
									</div>
									<Show when={error()}>
										<p class="login-error" style={{ "margin-bottom": "12px" }}>{error()}</p>
									</Show>
									<button type="submit" class="btn btn-primary">Log Entry</button>
								</form>
							</div>

							{/* Entries */}
							<div style={{ display: "flex", "justify-content": "space-between", "align-items": "baseline" }}>
								<div class="section-heading" style={{ "margin-top": "0" }}>
									Time Entries
								</div>
								<div class="muted mono" style={{ "font-size": "13px" }}>
									Total: {totalHours()} hrs
								</div>
							</div>
							<Show
								when={(entries() ?? []).length > 0}
								fallback={<p class="empty">No entries yet.</p>}
							>
								<table class="table">
									<thead>
										<tr>
											<th>Date</th>
											<th>Description</th>
											<th style={{ "text-align": "right" }}>Hours</th>
											<th></th>
										</tr>
									</thead>
									<tbody>
										<For each={entries() ?? []}>
											{(e) => (
												<tr>
													<td class="muted" style={{ "white-space": "nowrap" }}>
														{new Date(e.entry_date).toLocaleDateString("en-US", {
															month: "short",
															day: "numeric",
															year: "numeric",
														})}
													</td>
													<td>{e.description}</td>
													<td class="hours" style={{ "text-align": "right" }}>{e.hours}</td>
													<td style={{ width: "40px" }}>
														<button class="delete-btn" onClick={() => handleDelete(e.id)}>×</button>
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
