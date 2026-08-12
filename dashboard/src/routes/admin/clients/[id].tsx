import { Title } from "@solidjs/meta";
import { A, createAsync, useAction, useParams } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import Layout from "~/components/Layout";
import {
	createDocumentLinkAction,
	createInvoiceAction,
	deleteDocumentAction,
	deleteInvoiceAction,
	getDocumentsQuery,
	getInvoicesQuery,
	getProjectsForSelectQuery,
} from "~/lib/admin-queries";
import { getClientsQuery } from "~/lib/admin-queries";
import { getUserQuery } from "~/lib/queries";
import type { DocumentType, InvoiceStatus } from "~/lib/supabase";

export default function ClientDetail() {
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const clients = createAsync(() => getClientsQuery(), { deferStream: true });
	const params = useParams();

	const clientId = () => params.id;

	// Find the client from the list
	const client = () =>
		(clients() ?? []).find((c) => c.id === clientId());
	const projectId = () => client()?.project_id ?? "";

	const docs = createAsync(
		() => (projectId() ? getDocumentsQuery(projectId()) : Promise.resolve([])),
		{ deferStream: true },
	);
	const invoices = createAsync(
		() => (projectId() ? getInvoicesQuery(projectId()) : Promise.resolve([])),
		{ deferStream: true },
	);

	const addDocLink = useAction(createDocumentLinkAction);
	const deleteDoc = useAction(deleteDocumentAction);
	const addInvoice = useAction(createInvoiceAction);
	const deleteInvoice = useAction(deleteInvoiceAction);

	const [showDocForm, setShowDocForm] = createSignal(false);
	const [showTranscriptForm, setShowTranscriptForm] = createSignal(false);
	const [showInvForm, setShowInvForm] = createSignal(false);
	const [docError, setDocError] = createSignal("");
	const [invError, setInvError] = createSignal("");

	const referer = () => `/admin/clients/${clientId()}`;

	async function handleDocLink(e: Event) {
		e.preventDefault();
		setDocError("");
		const fd = new FormData(e.target as HTMLFormElement);
		fd.set("_referer", referer());
		const result = await addDocLink(fd);
		if (result?.error) setDocError(result.error);
	}

	async function handleInvoice(e: Event) {
		e.preventDefault();
		setInvError("");
		const fd = new FormData(e.target as HTMLFormElement);
		fd.set("_referer", referer());
		const result = await addInvoice(fd);
		if (result?.error) setInvError(result.error);
	}

	const today = new Date().toISOString().slice(0, 10);

	return (
		<Layout user={user()}>
			<Title>Client Detail — Mad Cactus</Title>
			<A href="/admin/clients" class="muted" style={{ "font-size": "13px", "margin-bottom": "8px", display: "inline-block" }}>
				All Clients
			</A>

			<Show when={client()} fallback={<p class="muted">Loading…</p>}>
				{(c) => (
					<>
						<h1 class="page-title">{c().name}</h1>
						<p class="page-subtitle">
							{c().email} · {c().project?.name}
						</p>

						{/* ── Documents section ─────────────────────── */}
						<div style={{ "margin-top": "40px" }}>
							<div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "16px" }}>
								<div class="section-heading" style={{ margin: "0" }}>Documents</div>
								<div style={{ display: "flex", gap: "8px" }}>
									<button class="btn btn-sm" onClick={() => setShowDocForm(!showDocForm())}>
										Add Link
									</button>
									<button class="btn btn-sm" onClick={() => setShowTranscriptForm(!showTranscriptForm())}>
										Add Transcript
									</button>
									<form method="post" action="/api/upload" enctype="multipart/form-data">
										<input type="hidden" name="project_id" value={projectId()} />
										<input type="hidden" name="_referer" value={referer()} />
										<label
							class="btn btn-sm btn-primary"
							style={{ cursor: "pointer", display: "inline-block" }}
										>
											Upload File
											<input
												type="file"
												name="file"
												style={{ display: "none" }}
												onChange={(e) => {
													const f = e.currentTarget;
													if (f.files?.length) {
														const titleInput = document.createElement("input");
														titleInput.type = "hidden";
														titleInput.name = "title";
														titleInput.value = f.files[0].name;
														f.form!.appendChild(titleInput);
														f.form!.submit();
													}
												}}
											/>
										</label>
									</form>
								</div>
							</div>

							<Show when={showTranscriptForm()}>
								<div class="card" style={{ "margin-bottom": "16px" }}>
									<form method="post" action="/api/upload-transcript" enctype="multipart/form-data">
										<div class="form-group">
										<label for="tr_title">Title</label>
										<input type="text" id="tr_title" name="title" required placeholder="CDL Sync W34" />
										</div>
										<div class="form-group">
										<label for="tr_desc">Description (optional)</label>
										<input type="text" id="tr_desc" name="description" placeholder="Weekly team sync" />
										</div>
										<div class="form-group">
										<label for="tr_content">Transcript text</label>
										<textarea id="tr_content" name="content" rows={8} required placeholder="Paste the trimmed transcript here. This text becomes searchable via RAG…" />
										</div>
										<div class="form-group">
										<label for="tr_audio">Audio file (optional)</label>
										<input type="file" id="tr_audio" name="audio" accept="audio/*" />
										</div>
										<input type="hidden" name="project_id" value={projectId()} />
										<input type="hidden" name="_referer" value={referer()} />
										<button type="submit" class="btn btn-primary">Add Transcript</button>
									</form>
								</div>
							</Show>

							<Show when={showDocForm()}>
								<div class="card" style={{ "margin-bottom": "16px" }}>
									<form onSubmit={handleDocLink}>
										<div class="form-row">
											<div class="form-group">
												<label for="doc_title">Title</label>
												<input type="text" id="doc_title" name="title" required placeholder="Project Brief" />
											</div>
											<div class="form-group">
												<label for="doc_type">Type</label>
												<select id="doc_type" name="type">
													<option value="link">Link (Google Docs, etc.)</option>
													<option value="transcript">Transcript Link</option>
												</select>
											</div>
										</div>
										<div class="form-group">
											<label for="doc_url">URL</label>
											<input type="url" id="doc_url" name="url" required placeholder="https://docs.google.com/…" />
										</div>
										<div class="form-group">
											<label for="doc_desc">Description (optional)</label>
											<input type="text" id="doc_desc" name="description" placeholder="Brief description" />
									</div>
									<div class="form-group">
										<label for="doc_content">Content for search (optional)</label>
										<textarea id="doc_content" name="content" rows={4} placeholder="Paste key text from the doc to make it searchable via RAG…" />
									</div>
										<input type="hidden" name="project_id" value={projectId()} />
										<Show when={docError()}>
											<p class="login-error">{docError()}</p>
										</Show>
										<button type="submit" class="btn btn-primary">Add Link</button>
									</form>
								</div>
							</Show>

							<Show when={docs()} fallback={<p class="muted">Loading…</p>}>
								{(list) => (
									<Show when={list().length > 0} fallback={<div class="card empty">No documents yet.</div>}>
										<div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
											<For each={list()}>
												{(doc) => (
													<div class="card" style={{ display: "flex", "align-items": "center", gap: "12px", padding: "14px 20px" }}>
														<div style={{ flex: "1" }}>
															<span style={{ "font-size": "14px" }}>{doc.title}</span>
															<span class="badge badge-paused" style={{ "margin-left": "8px", "text-transform": "capitalize" }}>{doc.type}</span>
															<Show when={doc.file_name}>
																<span class="muted" style={{ "font-size": "12px", "margin-left": "8px" }}>{doc.file_name}</span>
															</Show>
														</div>
														<Show when={doc.type === "link" && doc.url}>
															<a href={doc.url!} target="_blank" rel="noopener noreferrer" class="btn btn-sm">Open</a>
														</Show>
														<Show when={doc.url && doc.type !== "link"}>
															<a href={`/api/download?path=${encodeURIComponent(doc.url!)}`} class="btn btn-sm" download="">Download</a>
														</Show>
														<form method="post" action="/admin/clients/delete-doc" style={{ display: "inline" }}>
															<input type="hidden" name="id" value={doc.id} />
															<Show when={doc.url && doc.type !== "link"}>
																<input type="hidden" name="storage_path" value={doc.url!} />
															</Show>
																<Show when={doc.audio_path}>
																	<input type="hidden" name="audio_path" value={doc.audio_path!} />
																</Show>
															<input type="hidden" name="_referer" value={referer()} />
															<button type="submit" class="btn btn-sm" style={{ color: "#ef4444" }}>Delete</button>
														</form>
													</div>
												)}
											</For>
										</div>
									</Show>
								)}
							</Show>
						</div>

						{/* ── Invoices section ──────────────────────── */}
						<div style={{ "margin-top": "40px" }}>
							<div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "16px" }}>
								<div class="section-heading" style={{ margin: "0" }}>Invoices</div>
								<button class="btn btn-sm" onClick={() => setShowInvForm(!showInvForm())}>
									New Invoice
								</button>
							</div>

							<Show when={showInvForm()}>
								<div class="card" style={{ "margin-bottom": "16px" }}>
									<form onSubmit={handleInvoice}>
										<div class="form-row">
											<div class="form-group">
												<label for="inv_number">Invoice #</label>
												<input type="text" id="inv_number" name="number" required placeholder="INV-2026-003" />
											</div>
											<div class="form-group">
												<label for="inv_amount">Amount ($)</label>
												<input type="number" id="inv_amount" name="amount" required step="0.01" min="0" placeholder="6000.00" />
											</div>
										</div>
										<div class="form-row">
											<div class="form-group">
												<label for="inv_status">Status</label>
												<select id="inv_status" name="status">
													<option value="draft">Draft</option>
													<option value="sent">Sent</option>
												</select>
											</div>
											<div class="form-group">
												<label for="inv_issue">Issue Date</label>
												<input type="date" id="inv_issue" name="issue_date" required value={today} />
											</div>
										</div>
										<div class="form-row">
											<div class="form-group">
												<label for="inv_due">Due Date (optional)</label>
												<input type="date" id="inv_due" name="due_date" />
											</div>
											<div class="form-group">
												<label for="inv_pay">Payment URL (optional)</label>
												<input type="url" id="inv_pay" name="payment_url" placeholder="https://stripe.com/…" />
											</div>
										</div>
										<div class="form-group">
											<label for="inv_notes">Notes</label>
											<input type="text" id="inv_notes" name="notes" placeholder="July retainer" />
										</div>
										<input type="hidden" name="project_id" value={projectId()} />
										<Show when={invError()}>
											<p class="login-error">{invError()}</p>
										</Show>
										<button type="submit" class="btn btn-primary">Create Invoice</button>
									</form>
								</div>
							</Show>

							<Show when={invoices()} fallback={<p class="muted">Loading…</p>}>
								{(list) => (
									<Show when={list().length > 0} fallback={<div class="card empty">No invoices yet.</div>}>
										<table class="table">
											<thead>
												<tr>
													<th>#</th>
													<th>Amount</th>
													<th>Status</th>
													<th>Due</th>
													<th>Pay URL</th>
													<th></th>
												</tr>
											</thead>
											<tbody>
												<For each={list()}>
													{(inv) => (
														<tr>
															<td class="mono">{inv.number}</td>
															<td class="mono">${inv.amount.toLocaleString()}</td>
															<td>
																<span class={`badge badge-${inv.status === "paid" ? "completed" : inv.status === "void" ? "paused" : "active"}`}>
																	{inv.status}
																</span>
															</td>
															<td class="muted">{inv.due_date ?? "—"}</td>
															<td>
																<Show when={inv.payment_url}>
																	<a href={inv.payment_url!} target="_blank" rel="noopener noreferrer" class="muted">Link</a>
																</Show>
															</td>
															<td>
																<form method="post" action="/admin/clients/delete-inv" style={{ display: "inline" }}>
																	<input type="hidden" name="id" value={inv.id} />
																	<Show when={inv.storage_path}>
																		<input type="hidden" name="storage_path" value={inv.storage_path!} />
																	</Show>
																	<input type="hidden" name="_referer" value={referer()} />
																	<button type="submit" class="btn btn-sm" style={{ color: "#ef4444" }}>Delete</button>
																</form>
															</td>
														</tr>
													)}
												</For>
											</tbody>
										</table>
									</Show>
								)}
							</Show>
						</div>
					</>
				)}
			</Show>
		</Layout>
	);
}
