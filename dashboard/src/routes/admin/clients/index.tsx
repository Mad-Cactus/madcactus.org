import { Title } from "@solidjs/meta";
import { A, createAsync, useAction } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import Layout from "~/components/Layout";
import {
	createClientAction,
	getClientsQuery,
	getProjectsForSelectQuery,
	toggleClientActiveAction,
	updateClientPasswordAction,
} from "~/lib/admin-queries";
import { getUserQuery } from "~/lib/queries";

export default function Clients() {
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const clients = createAsync(() => getClientsQuery(), { deferStream: true });
	const projects = createAsync(() => getProjectsForSelectQuery(), {
		deferStream: true,
	});
	const createClient = useAction(createClientAction);
	const toggleActive = useAction(toggleClientActiveAction);
	const updatePassword = useAction(updateClientPasswordAction);

	const [showForm, setShowForm] = createSignal(false);
	const [pwModal, setPwModal] = createSignal<string | null>(null);
	const [newPw, setNewPw] = createSignal("");
	const [error, setError] = createSignal("");

	async function handleCreate(e: Event) {
		e.preventDefault();
		setError("");
		const fd = new FormData(e.target as HTMLFormElement);
		const result = await createClient(fd);
		if (result?.error) {
			setError(result.error);
		}
	}

	async function handlePwUpdate(e: Event) {
		e.preventDefault();
		setError("");
		const fd = new FormData();
		fd.set("id", pwModal()!);
		fd.set("password", newPw());
		const result = await updatePassword(fd);
		if (result?.error) {
			setError(result.error);
		}
	}

	return (
		<Layout user={user()}>
			<Title>Clients — Mad Cactus</Title>
			<div
				style={{
					display: "flex",
					"justify-content": "space-between",
					"align-items": "center",
					"margin-bottom": "32px",
				}}
			>
				<div>
					<h1 class="page-title">Clients</h1>
					<p class="page-subtitle" style={{ "margin-bottom": "0" }}>
						Client portal access
					</p>
				</div>
				<button
					class="btn btn-primary"
					onClick={() => setShowForm(!showForm())}
				>
					{showForm() ? "Cancel" : "+ New Client"}
				</button>
			</div>

			<Show when={showForm()}>
				<div class="card" style={{ "margin-bottom": "32px" }}>
					<h3 style={{ "margin-bottom": "16px" }}>Create Client Login</h3>
					<form onSubmit={handleCreate}>
						<div class="form-row">
							<div class="form-group">
								<label for="name">Client Name</label>
								<input
									type="text"
									id="name"
									name="name"
									required
									placeholder="John Smith"
								/>
							</div>
							<div class="form-group">
								<label for="email">Email (login)</label>
								<input
									type="email"
									id="email"
									name="email"
									required
									placeholder="john@company.com"
								/>
							</div>
						</div>
						<div class="form-row">
							<div class="form-group">
								<label for="project_id">Project</label>
								<select id="project_id" name="project_id" required>
									<Show when={projects()}>
										<For each={projects()}>
											{(p) => <option value={p.id}>{p.name}</option>}
										</For>
									</Show>
								</select>
							</div>
							<div class="form-group">
								<label for="password">Initial Password</label>
								<input
									type="text"
									id="password"
									name="password"
									required
									minlength="6"
									placeholder="Share this with the client"
								/>
							</div>
						</div>
						<Show when={error()}>
							<p class="login-error" style={{ "margin-bottom": "12px" }}>
								{error()}
							</p>
						</Show>
						<button type="submit" class="btn btn-primary">
							Create Client
						</button>
					</form>
				</div>
			</Show>

			<Suspense fallback={<p class="muted">Loading…</p>}>
				<Show
					when={clients()}
					fallback={<p class="muted">Loading…</p>}
				>
					{(list) => (
						<Show
							when={list().length > 0}
							fallback={
								<div class="card empty">
									No clients yet. Create one to give them portal access.
								</div>
							}
						>
							<table class="table">
								<thead>
									<tr>
										<th>Name</th>
										<th>Email</th>
										<th>Project</th>
										<th>Status</th>
										<th>Actions</th>
									</tr>
								</thead>
								<tbody>
									<For each={list()}>
										{(c) => (
											<tr>
												<td>
													<A
														href={`/clients/${c.id}`}
														class="gold"
													>
														{c.name}
													</A>
												</td>
												<td class="muted">{c.email}</td>
												<td>{c.project?.name ?? "—"}</td>
												<td>
													<span
														class={`badge ${c.is_active ? "badge-active" : "badge-paused"}`}
													>
														{c.is_active ? "active" : "disabled"}
													</span>
												</td>
												<td>
													<div style={{ display: "flex", gap: "8px" }}>
														<button
															class="btn btn-sm"
															onClick={() => setPwModal(c.id)}
														>
															Set Password
														</button>
														<form method="post" action="/admin/clients/toggle">
															<input
																type="hidden"
																name="id"
																value={c.id}
															/>
															<input
																type="hidden"
																name="is_active"
																value={String(c.is_active)}
															/>
															<button
																type="submit"
																class="btn btn-sm"
															>
																{c.is_active ? "Disable" : "Enable"}
															</button>
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

			{/* Password modal */}
			<Show when={pwModal()}>
				<div
					style={{
						position: "fixed",
						inset: "0",
						background: "rgba(0,0,0,0.7)",
						display: "flex",
						"align-items": "center",
						"justify-content": "center",
						"z-index": "100",
					}}
					onClick={() => setPwModal(null)}
				>
					<div
						class="card"
						style={{
							width: "400px",
							padding: "32px",
						}}
						onClick={(e) => e.stopPropagation()}
					>
						<h3 style={{ "margin-bottom": "16px" }}>Set New Password</h3>
						<form onSubmit={handlePwUpdate}>
							<div class="form-group">
								<label for="newpw">New Password</label>
								<input
									type="text"
									id="newpw"
									required
									minlength="6"
									value={newPw()}
									onInput={(e) => setNewPw(e.currentTarget.value)}
								/>
							</div>
							<Show when={error()}>
								<p class="login-error">{error()}</p>
							</Show>
							<div style={{ display: "flex", gap: "8px", "margin-top": "16px" }}>
								<button type="submit" class="btn btn-primary">
									Update
								</button>
								<button
									type="button"
									class="btn"
									onClick={() => {
										setPwModal(null);
										setNewPw("");
										setError("");
									}}
								>
									Cancel
								</button>
							</div>
						</form>
					</div>
				</div>
			</Show>
		</Layout>
	);
}
