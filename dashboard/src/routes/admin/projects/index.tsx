import { Title } from "@solidjs/meta";
import { A, createAsync, useAction } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import Layout from "~/components/Layout";
import {
	createProjectAction,
	getProjectsQuery,
	getUserQuery,
} from "~/lib/queries";
import type { ProjectStatus } from "~/lib/supabase";

const statusBadge: Record<ProjectStatus, string> = {
	active: "badge-active",
	paused: "badge-paused",
	completed: "badge-completed",
};

export default function Projects() {
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const projects = createAsync(() => getProjectsQuery(), { deferStream: true });
	const createProject = useAction(createProjectAction);
	const [showForm, setShowForm] = createSignal(false);
	const [error, setError] = createSignal("");

	async function handleSubmit(e: Event) {
		e.preventDefault();
		setError("");
		const fd = new FormData(e.target as HTMLFormElement);
		const result = await createProject(fd);
		if (result?.error) setError(result.error);
	}

	return (
		<Layout user={user()}>
			<Title>Projects — Mad Cactus</Title>
			<div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "32px" }}>
				<div>
					<h1 class="page-title">Projects</h1>
					<p class="page-subtitle" style={{ "margin-bottom": "0" }}>All engagements</p>
				</div>
				<button class="btn btn-primary" onClick={() => setShowForm(!showForm())}>
					{showForm() ? "Cancel" : "New Project"}
				</button>
			</div>

			<Show when={showForm()}>
				<div class="card" style={{ "margin-bottom": "32px" }}>
					<form onSubmit={handleSubmit}>
						<div class="form-row">
							<div class="form-group">
								<label for="name">Project Name</label>
								<input type="text" id="name" name="name" required placeholder="IU Data Agent" />
							</div>
							<div class="form-group">
								<label for="client_name">Client</label>
								<input type="text" id="client_name" name="client_name" required placeholder="Indiana University" />
							</div>
						</div>
						<div class="form-row">
							<div class="form-group">
								<label for="engagement_type">Engagement Type</label>
								<select id="engagement_type" name="engagement_type">
									<option value="hourly">Hourly</option>
									<option value="retainer">Retainer (monthly cap)</option>
									<option value="project">Project (fixed price)</option>
								</select>
							</div>
							<div class="form-group">
								<label for="hourly_rate">Hourly Rate ($)</label>
								<input type="number" id="hourly_rate" name="hourly_rate" step="1" min="0" value="200" />
							</div>
						</div>
						<div class="form-group">
							<label for="monthly_cap_hours">Monthly Cap (hours, retainer only)</label>
							<input type="number" id="monthly_cap_hours" name="monthly_cap_hours" step="1" min="0" placeholder="Leave blank if uncapped" />
						</div>
						<div class="form-group">
							<label for="notes">Scope / Notes</label>
							<textarea id="notes" name="notes" rows={3} placeholder="What's planned, scope boundaries, deliverables…" />
						</div>
						<Show when={error()}>
							<p class="login-error" style={{ "margin-bottom": "12px" }}>{error()}</p>
						</Show>
						<button type="submit" class="btn btn-primary">Create Project</button>
					</form>
				</div>
			</Show>

			<Suspense fallback={<p class="muted">Loading…</p>}>
				<Show when={projects()} fallback={<p class="muted">Loading…</p>}>
					{(list) => (
						<Show when={list().length > 0} fallback={
							<div class="card empty">No projects yet. Create your first one above.</div>
						}>
							<table class="table">
								<thead>
									<tr>
										<th>Project</th>
										<th>Client</th>
										<th>Type</th>
										<th>Rate</th>
										<th>Cap</th>
										<th>Status</th>
									</tr>
								</thead>
								<tbody>
									<For each={list()}>
										{(p) => (
											<tr>
												<td>
													<A href={`/admin/projects/${p.id}`} class="gold">{p.name}</A>
												</td>
												<td class="muted">{p.client_name}</td>
												<td style={{ "text-transform": "capitalize" }}>{p.engagement_type}</td>
												<td class="mono">${p.hourly_rate}/hr</td>
												<td class="muted">{p.monthly_cap_hours ? `${p.monthly_cap_hours}h` : "—"}</td>
												<td><span class={`badge ${statusBadge[p.status]}`}>{p.status}</span></td>
											</tr>
										)}
									</For>
								</tbody>
							</table>
						</Show>
					)}
				</Show>
			</Suspense>
		</Layout>
	);
}
