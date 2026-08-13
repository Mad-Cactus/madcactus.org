import { Title } from "@solidjs/meta";
import { A, createAsync, useAction, useParams, revalidate } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import Layout from "~/components/Layout";
import ProjectDocuments from "~/components/ProjectDocuments";
import {
	createMemberAction,
	linkMemberAction,
	unlinkMemberAction,
	getCompaniesQuery,
	getCompanyMembersQuery,
	getMembersQuery,
	getProjectsForSelectQuery,
	getInvoicesQuery,
	createInvoiceAction,
	deleteInvoiceAction,
} from "~/lib/admin-queries";
import { getUserQuery } from "~/lib/queries";
import type { InvoiceStatus } from "~/db/schema";

export default function CompanyDetail() {
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const params = useParams();
	const companyId = () => params.id!;

	const companies = createAsync(() => getCompaniesQuery(), { deferStream: true });
	const company = () => (companies() ?? []).find((c) => c.id === companyId());

	const companyMembers = createAsync(
		() => getCompanyMembersQuery(companyId()),
		{ deferStream: true },
	);
	const allMembers = createAsync(() => getMembersQuery(), { deferStream: true });
	const projects = createAsync(() => getProjectsForSelectQuery(), {
		deferStream: true,
	});
	const companyProjects = () =>
		(projects() ?? []).filter((p) => p.companyId === companyId());

	const createMember = useAction(createMemberAction);
	const linkMember = useAction(linkMemberAction);
	const unlinkMember = useAction(unlinkMemberAction);
	const addInvoice = useAction(createInvoiceAction);

	const [showMemberForm, setShowMemberForm] = createSignal(false);
	const [showLinkForm, setShowLinkForm] = createSignal(false);
	const [showInvForm, setShowInvForm] = createSignal<string | null>(null);
	const [error, setError] = createSignal("");
	const [success, setSuccess] = createSignal("");
	const [submitting, setSubmitting] = createSignal(false);

	const referer = () => `/admin/companies/${companyId()}`;
	const today = new Date().toISOString().slice(0, 10);

	// Members not yet linked to this company
	const unlinkedMembers = () =>
		(allMembers() ?? []).filter(
			(m) => !(companyMembers() ?? []).some((cm) => cm.id === m.id),
		);

	async function handleCreateMember(e: Event) {
		e.preventDefault();
		setError("");
		setSuccess("");
		setSubmitting(true);
		try {
			const fd = new FormData(e.target as HTMLFormElement);
			fd.set("company_id", companyId());
			const result = await createMember(fd);
			if (result?.error) {
				setError(result.error);
				return;
			}
			if (result?.success) {
				setSuccess(result.success);
				setShowMemberForm(false);
				(e.target as HTMLFormElement).reset();
				await revalidate(getCompanyMembersQuery.key);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Something went wrong.");
		} finally {
			setSubmitting(false);
		}
	}

	async function handleLink(e: Event) {
		e.preventDefault();
		const fd = new FormData(e.target as HTMLFormElement);
		fd.set("company_id", companyId());
		await linkMember(fd);
	}

	async function handleInvoice(e: Event, projectId: string) {
		e.preventDefault();
		const fd = new FormData(e.target as HTMLFormElement);
		fd.set("project_id", projectId);
		fd.set("_referer", referer());
		await addInvoice(fd);
	}

	return (
		<Layout user={user()}>
			<Title>Company Detail — Mad Cactus</Title>
			<A href="/admin/companies" class="muted" style={{ "font-size": "13px", "margin-bottom": "8px", display: "inline-block" }}>
				All Companies
			</A>

			<Show when={company()} fallback={<p class="muted">Loading…</p>}>
				{(c) => (
					<>
						<h1 class="page-title">{c().name}</h1>

						{/* ── Members ─────────────────────────────────── */}
						<div style={{ "margin-top": "32px" }}>
							<div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "16px" }}>
								<div class="section-heading" style={{ margin: "0" }}>Members</div>
								<div style={{ display: "flex", gap: "8px" }}>
									<button class="btn btn-sm" onClick={() => setShowLinkForm(!showLinkForm())}>
										Link Existing
									</button>
									<button class="btn btn-sm btn-primary" onClick={() => setShowMemberForm(!showMemberForm())}>
										Add Member
									</button>
								</div>
							</div>

							<Show when={showLinkForm()}>
								<div class="card" style={{ "margin-bottom": "16px" }}>
									<form onSubmit={handleLink}>
										<div class="form-row">
											<div class="form-group">
												<label for="member_id">Select Member</label>
												<select id="member_id" name="member_id" required>
													<option value="" disabled selected>Choose…</option>
													<For each={unlinkedMembers()}>
														{(m) => <option value={m.id}>{m.name} ({m.email})</option>}
													</For>
												</select>
											</div>
										</div>
										<button type="submit" class="btn btn-primary">Link</button>
									</form>
								</div>
							</Show>

							<Show when={showMemberForm()}>
								<div class="card" style={{ "margin-bottom": "16px" }}>
									<form onSubmit={handleCreateMember}>
										<div class="form-row">
											<div class="form-group">
												<label for="m_name">Name</label>
												<input type="text" id="m_name" name="name" required placeholder="John Smith" />
											</div>
											<div class="form-group">
												<label for="m_email">Email (login)</label>
												<input type="email" id="m_email" name="email" required placeholder="john@company.com" />
											</div>
										</div>
										<p class="muted" style={{ "font-size": "12px", "margin-bottom": "12px" }}>An invite email will be sent so they can set their own password.</p>
										<Show when={error()}><p class="login-error">{error()}</p></Show>
										<button type="submit" class="btn btn-primary" disabled={submitting()}>{submitting() ? "Sending…" : "Create + Link"}</button>
									</form>
								</div>
							</Show>

						<Show when={success()}>
							<p style={{ color: "#16a34a", "font-size": "13px", "margin-bottom": "12px" }}>{success()}</p>
						</Show>

							<Suspense fallback={<p class="muted">Loading…</p>}>
								<Show when={companyMembers()}>
									{(list) => (
										<Show when={list().length > 0} fallback={<div class="card empty">No members yet.</div>}>
											<div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
												<For each={list()}>
													{(m) => (
														<div class="card" style={{ display: "flex", "align-items": "center", gap: "12px", padding: "14px 20px" }}>
															<div style={{ flex: "1" }}>
																<span style={{ "font-size": "14px" }}>{m.name}</span>
																<span class="muted" style={{ "font-size": "12px", "margin-left": "8px" }}>{m.email}</span>
																<span class={`badge ${m.isActive ? "badge-active" : "badge-paused"}`} style={{ "margin-left": "8px" }}>
																	{m.isActive ? "active" : "disabled"}
																</span>
															</div>
															<form method="post" action="/admin/companies/unlink-member">
																<input type="hidden" name="member_id" value={m.id} />
																<input type="hidden" name="company_id" value={companyId()} />
																<button type="submit" class="btn btn-sm" style={{ color: "#ef4444" }}>Unlink</button>
															</form>
														</div>
													)}
												</For>
											</div>
										</Show>
									)}
								</Show>
							</Suspense>
						</div>

						{/* ── Projects ────────────────────────────────── */}
						<Suspense fallback={<p class="muted">Loading…</p>}>
							<div style={{ "margin-top": "40px" }}>
								<div class="section-heading">Projects</div>
								<Show when={companyProjects().length > 0} fallback={<div class="card empty">No projects yet for this company.</div>}>
									<For each={companyProjects()}>
										{(proj) => (
											<CompanyProjectSection
												proj={proj}
												referer={referer()}
												today={today}
												showInvForm={showInvForm() === proj.id}
												toggleInvForm={() => setShowInvForm(showInvForm() === proj.id ? null : proj.id)}
												onInvoice={(e) => handleInvoice(e, proj.id)}
											/>
										)}
									</For>
								</Show>
							</div>
						</Suspense>
					</>
				)}
			</Show>
		</Layout>
	);
}

// ── Per-project section (docs + invoices) ──────────────────────────

function CompanyProjectSection(props: {
	proj: { id: string; name: string; companyName: string };
	referer: string;
	today: string;
	showInvForm: boolean;
	toggleInvForm: () => void;
	onInvoice: (e: Event) => void;
}) {
	const invoices = createAsync(() => getInvoicesQuery(props.proj.id), { deferStream: true });
	const deleteInvoice = useAction(deleteInvoiceAction);

	return (
		<div class="card" style={{ "margin-bottom": "16px", padding: "24px" }}>
			<div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "16px" }}>
				<A href={`/admin/projects/${props.proj.id}`} class="gold" style={{ "font-size": "16px", "font-weight": "500" }}>
					{props.proj.name}
				</A>
			</div>

			<ProjectDocuments projectId={props.proj.id} referer={props.referer} />

			{/* Invoices */}
			<div>
				<div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "8px" }}>
					<span class="muted" style={{ "font-size": "13px" }}>Invoices</span>
					<button class="btn btn-sm" onClick={props.toggleInvForm}>New Invoice</button>
				</div>
				<Show when={props.showInvForm}>
					<div class="card" style={{ "margin-bottom": "8px", padding: "16px" }}>
						<form onSubmit={props.onInvoice}>
							<div class="form-row">
								<div class="form-group">
									<label for={`inv_num_${props.proj.id}`}>Invoice #</label>
									<input type="text" id={`inv_num_${props.proj.id}`} name="number" required placeholder="INV-2026-003" />
								</div>
								<div class="form-group">
									<label for={`inv_amt_${props.proj.id}`}>Amount ($)</label>
									<input type="number" id={`inv_amt_${props.proj.id}`} name="amount" required step="0.01" min="0" placeholder="6000.00" />
								</div>
							</div>
							<div class="form-row">
								<div class="form-group">
									<label for={`inv_st_${props.proj.id}`}>Status</label>
									<select id={`inv_st_${props.proj.id}`} name="status">
										<option value="draft">Draft</option>
										<option value="sent">Sent</option>
									</select>
								</div>
								<div class="form-group">
									<label for={`inv_iss_${props.proj.id}`}>Issue Date</label>
									<input type="date" id={`inv_iss_${props.proj.id}`} name="issue_date" required value={props.today} />
								</div>
							</div>
							<div class="form-group">
								<label for={`inv_due_${props.proj.id}`}>Due Date</label>
								<input type="date" id={`inv_due_${props.proj.id}`} name="due_date" />
							</div>
							<button type="submit" class="btn btn-primary">Create</button>
						</form>
					</div>
				</Show>
				<Suspense fallback={<p class="muted" style={{ "font-size": "12px" }}>Loading…</p>}>
					<Show when={invoices()}>
						{(list) => (
							<Show when={list().length > 0} fallback={<p class="muted" style={{ "font-size": "12px" }}>No invoices.</p>}>
								<For each={list()}>
									{(inv) => (
										<div style={{ display: "flex", "align-items": "center", gap: "8px", "font-size": "13px", "margin-bottom": "4px" }}>
											<span class="mono">{inv.number}</span>
											<span class="mono">${inv.amount.toLocaleString()}</span>
											<span class={`badge ${inv.status === "paid" ? "badge-completed" : inv.status === "void" ? "badge-paused" : "badge-active"}`} style={{ "text-transform": "capitalize" }}>
												{inv.status}
											</span>
											<Show when={inv.paymentUrl}>
												<a href={inv.paymentUrl!} target="_blank" rel="noopener noreferrer" class="muted" style={{ "font-size": "12px" }}>Pay</a>
											</Show>
											<form method="post" action="/admin/companies/delete-inv" style={{ display: "inline", "margin-left": "auto" }}>
												<input type="hidden" name="id" value={inv.id} />
												<Show when={inv.storagePath}>
													<input type="hidden" name="storage_path" value={inv.storagePath!} />
												</Show>
												<input type="hidden" name="_referer" value={props.referer} />
												<button type="submit" class="btn btn-sm" style={{ color: "#ef4444" }}>Delete</button>
											</form>
										</div>
									)}
								</For>
							</Show>
						)}
					</Show>
				</Suspense>
			</div>
		</div>
	);
}
