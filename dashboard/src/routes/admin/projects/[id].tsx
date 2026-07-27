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
import { getDeliverablesQuery } from "~/lib/admin-queries";
import type { DeliverableStatus } from "~/lib/supabase";

const STATUS_OPTIONS: DeliverableStatus[] = [
	"planned",
	"in_progress",
	"review",
	"completed",
	"blocked",
];

const statusBadge: Record<DeliverableStatus, string> = {
	planned: "badge-paused",
	in_progress: "badge-active",
	review: "badge-active",
	completed: "badge-completed",
	blocked: "badge-paused",
};

export default function ProjectDetail() {
	const params = useParams();
	const navigate = useNavigate();
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const project = createAsync(() => getProjectQuery(params.id!), { deferStream: true });
	const entries = createAsync(() => getProjectEntriesQuery(params.id!), { deferStream: true });
	const deliverables = createAsync(() => getDeliverablesQuery(params.id!), { deferStream: true });
	const createEntry = useAction(createTimeEntryAction);
	const deleteEntry = useAction(deleteTimeEntryAction);
	const [error, setError] = createSignal("");
	const [showDeliverableForm, setShowDeliverableForm] = createSignal(false);
	const [updateDeliverableId, setUpdateDeliverableId] = createSignal<string | null>(null);

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
								All Projects
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

							{/* Deliverables — client-visible */}
							<div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "16px" }}>
								<div class="section-heading" style={{ margin: "0" }}>Deliverables</div>
								<button class="btn btn-sm" onClick={() => setShowDeliverableForm(!showDeliverableForm())}>
									{showDeliverableForm() ? "Cancel" : "Add Deliverable"}
								</button>
							</div>

							<Show when={showDeliverableForm()}>
								<div class="card" style={{ "margin-bottom": "16px" }}>
									<form method="post" action="/admin/projects/create-deliverable">
										<input type="hidden" name="project_id" value={p().id} />
										<input type="hidden" name="_referer" value={`/admin/projects/${params.id}`} />
										<div class="form-group">
											<label for="delv_title">Title</label>
											<input type="text" id="delv_title" name="title" required placeholder="Discovery & Requirements" />
										</div>
										<div class="form-group">
											<label for="delv_desc">Description</label>
											<textarea id="delv_desc" name="description" rows={2} placeholder="What does this deliverable include?" />
										</div>
										<button type="submit" class="btn btn-primary">Create Deliverable</button>
									</form>
								</div>
							</Show>

							<Suspense fallback={<p class="muted">Loading…</p>}>
								<Show when={deliverables()} fallback={<p class="muted">Loading…</p>}>
									{(list) => (
										<Show when={list().length > 0} fallback={<div class="card empty">No deliverables yet.</div>}>
											<div style={{ display: "flex", "flex-direction": "column", gap: "12px", "margin-bottom": "40px" }}>
												<For each={list()}>
													{(delv) => (
														<div class="card" style={{ padding: "20px" }}>
															<div style={{ display: "flex", "justify-content": "space-between", "align-items": "flex-start", gap: "12px" }}>
																<div style={{ flex: "1" }}>
																	<span style={{ "font-size": "15px", "font-weight": "500" }}>{delv.title}</span>
																	<span class={`badge ${statusBadge[delv.status]}`} style={{ "margin-left": "8px", "text-transform": "capitalize" }}>
																		{delv.status.replace("_", " ")}
																	</span>
																</div>
																{/* Status changer */}
																<form method="post" action="/admin/projects/update-deliverable" style={{ display: "inline-flex", gap: "0" }}>
																	<input type="hidden" name="id" value={delv.id} />
																	<input type="hidden" name="_referer" value={`/admin/projects/${params.id}`} />
																	<select name="status" onchange={(e) => e.currentTarget.form?.submit()} style={{ "padding": "6px 12px", "font-size": "13px", "border-radius": "6px", "cursor": "pointer" }}>
																		<For each={STATUS_OPTIONS}>
																			{(opt) => (
																				<option value={opt} selected={opt === delv.status}>
																					{opt.replace("_", " ")}
																				</option>
																			)}
																		</For>
																	</select>
																</form>
															</div>
															<Show when={delv.description}>
																<p class="muted" style={{ "font-size": "13px", "margin-top": "6px" }}>{delv.description}</p>
															</Show>

															{/* Updates */}
															<Show when={delv.updates.length > 0}>
																<div style={{ "margin-top": "12px", "padding-left": "12px", "border-left": "2px solid rgba(201,168,76,0.2)" }}>
																	<For each={delv.updates}>
																		{(upd) => (
																			<div style={{ "margin-bottom": "8px" }}>
																				<div class="muted" style={{ "font-size": "11px" }}>
																					{new Date(upd.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
																				</div>
																				<div style={{ "font-size": "13px", "line-height": "1.5" }}>{upd.body}</div>
																			</div>
																		)}
																	</For>
																</div>
															</Show>

															{/* Add update + delete */}
															<div style={{ display: "flex", gap: "8px", "margin-top": "12px", "align-items": "center" }}>
																<Show
																	when={updateDeliverableId() === delv.id}
																	fallback={
																		<button class="btn btn-sm" onClick={() => setUpdateDeliverableId(delv.id)}>
																			Add Update
																		</button>
																	}
																>
																	<form method="post" action="/admin/projects/add-update" style={{ flex: "1", display: "flex", gap: "8px" }}>
																		<input type="hidden" name="deliverable_id" value={delv.id} />
																		<input type="hidden" name="_referer" value={`/admin/projects/${params.id}`} />
																		<input type="text" name="body" placeholder="Progress update…" required style={{ flex: "1", "padding": "8px 14px", "font-size": "13px" }} />
																		<button type="submit" class="btn btn-sm btn-primary">Post</button>
																		<button type="button" class="btn btn-sm" onClick={() => setUpdateDeliverableId(null)}>Cancel</button>
																	</form>
																</Show>
																<form method="post" action="/admin/projects/delete-deliverable" style={{ display: "inline", "margin-left": "auto" }}>
																	<input type="hidden" name="id" value={delv.id} />
																	<input type="hidden" name="_referer" value={`/admin/projects/${params.id}`} />
																	<button type="submit" class="btn btn-sm" style={{ color: "#ef4444" }}>Delete</button>
																</form>
															</div>
														</div>
													)}
												</For>
											</div>
										</Show>
									)}
								</Show>
							</Suspense>

							{/* Log form — admin only */}
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
														<button class="delete-btn" onClick={() => handleDelete(e.id)}>Delete</button>
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
