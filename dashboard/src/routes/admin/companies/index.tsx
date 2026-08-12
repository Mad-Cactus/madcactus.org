import { Title } from "@solidjs/meta";
import { A, createAsync, useAction } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import Layout from "~/components/Layout";
import {
	createCompanyAction,
	getCompaniesQuery,
	getMembersQuery,
	resendInviteAction,
	toggleMemberActiveAction,
	linkMemberAction,
} from "~/lib/admin-queries";
import { getUserQuery } from "~/lib/queries";

export default function Companies() {
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const companies = createAsync(() => getCompaniesQuery(), {
		deferStream: true,
	});
	const members = createAsync(() => getMembersQuery(), { deferStream: true });
	const createCompany = useAction(createCompanyAction);
	const resendInvite = useAction(resendInviteAction);
	const toggleActive = useAction(toggleMemberActiveAction);
	const linkMember = useAction(linkMemberAction);

	const [showForm, setShowForm] = createSignal(false);
	const [showLinkForm, setShowLinkForm] = createSignal<string | null>(null);
	const [error, setError] = createSignal("");

	async function handleCreate(e: Event) {
		e.preventDefault();
		setError("");
		const fd = new FormData(e.target as HTMLFormElement);
		const result = await createCompany(fd);
		if (result?.error) setError(result.error);
	}

	async function handleResend(id: string) {
		setError("");
		const fd = new FormData();
		fd.set("id", id);
		const result = await resendInvite(fd);
		if (result?.error) setError(result.error);
	}

	return (
		<Layout user={user()}>
			<Title>Companies — Mad Cactus</Title>
			<div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "32px" }}>
				<div>
					<h1 class="page-title">Companies</h1>
					<p class="page-subtitle" style={{ "margin-bottom": "0" }}>
						Client organizations + portal access
					</p>
				</div>
				<button class="btn btn-primary" onClick={() => setShowForm(!showForm())}>
					{showForm() ? "Cancel" : "New Company"}
				</button>
			</div>

			<Show when={showForm()}>
				<div class="card" style={{ "margin-bottom": "32px" }}>
					<h3 style={{ "margin-bottom": "16px" }}>Create Company</h3>
					<form onSubmit={handleCreate}>
						<div class="form-group">
							<label for="name">Company Name</label>
							<input type="text" id="name" name="name" required placeholder="Indiana University" />
						</div>
						<Show when={error()}>
							<p class="login-error" style={{ "margin-bottom": "12px" }}>{error()}</p>
						</Show>
						<button type="submit" class="btn btn-primary">Create</button>
					</form>
				</div>
			</Show>

			<Suspense fallback={<p class="muted">Loading…</p>}>
				<Show when={companies()} fallback={<p class="muted">Loading…</p>}>
					{(list) => (
						<Show when={list().length > 0} fallback={
							<div class="card empty">No companies yet. Create one above.</div>
						}>
							<table class="table">
								<thead>
									<tr>
										<th>Company</th>
										<th>Members</th>
										<th>Created</th>
										<th>Actions</th>
									</tr>
								</thead>
								<tbody>
									<For each={list()}>
										{(c) => (
											<tr>
												<td>
													<A href={`/admin/companies/${c.id}`} class="gold">{c.name}</A>
												</td>
												<td class="muted">
													{(members() ?? []).filter((m) =>
														// ponytail: member-company link shown on detail page; here just count
														false,
													).length}
												</td>
												<td class="muted">{new Date(c.createdAt).toLocaleDateString()}</td>
												<td>
													<A href={`/admin/companies/${c.id}`} class="btn btn-sm">Manage</A>
												</td>
											</tr>
										)}
									</For>
								</tbody>
							</table>
						</Show>
					)}
				</Show>
			</Suspense>

			{/* ── Members section ─────────────────────────────────── */}
			<div style={{ "margin-top": "48px" }}>
				<div class="section-heading">Portal Members</div>
				<Suspense fallback={<p class="muted">Loading…</p>}>
					<Show when={members()} fallback={<p class="muted">Loading…</p>}>
						{(list) => (
							<Show when={list().length > 0} fallback={
								<div class="card empty">No members yet. Add them from a company detail page.</div>
							}>
								<table class="table">
									<thead>
										<tr>
											<th>Name</th>
											<th>Email</th>
											<th>Status</th>
											<th>Actions</th>
										</tr>
									</thead>
									<tbody>
										<For each={list()}>
											{(m) => (
												<tr>
													<td>{m.name}</td>
													<td class="muted">{m.email}</td>
													<td>
														<span class={`badge ${m.isActive ? "badge-active" : "badge-paused"}`}>
															{m.isActive ? "active" : "disabled"}
														</span>
													</td>
													<td>
														<div style={{ display: "flex", gap: "8px" }}>
															<button class="btn btn-sm" onClick={() => handleResend(m.id)}>Resend Invite</button>
															<form method="post" action="/admin/companies/toggle-member">
																<input type="hidden" name="id" value={m.id} />
																<input type="hidden" name="is_active" value={String(m.isActive)} />
																<button type="submit" class="btn btn-sm">{m.isActive ? "Disable" : "Enable"}</button>
															</form>
														</div>
													</td>
												</tr>
											)}
										</For>
									</tbody>
								</table>
							</Show>
						)}
					</Show>
				</Suspense>
			</div>

		</Layout>
	);
}
