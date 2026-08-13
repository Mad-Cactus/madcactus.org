import { Title } from "@solidjs/meta";
import { createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";
import PortalLayout from "~/components/PortalLayout";
import {
	getClientInvoicesQuery,
	getClientUserQuery,
} from "~/lib/client-queries";
import type { InvoiceStatus } from "~/db/schema";

const statusBadge: Record<InvoiceStatus, string> = {
	draft: "badge-paused",
	sent: "badge-active",
	paid: "badge-completed",
	void: "badge-paused",
};

export default function PortalInvoices() {
	const user = createAsync(() => getClientUserQuery(), { deferStream: true });
	const invoices = createAsync(() => getClientInvoicesQuery(), {
		deferStream: true,
	});

	return (
		<PortalLayout user={user()}>
			<Title>Invoices — Mad Cactus Client Portal</Title>
			<h1 class="page-title">Invoices</h1>
			<p class="page-subtitle">Billing history and payment links</p>

			<div style={{ "margin-top": "32px" }}>
				<Show when={invoices()} fallback={<p class="muted">Loading…</p>}>
					{(list) => (
						<Show
							when={list().length > 0}
							fallback={<div class="card empty">No invoices yet.</div>}
						>
							<table class="table">
								<thead>
									<tr>
										<th>Invoice #</th>
										<th>Amount</th>
										<th>Issued</th>
										<th>Due</th>
										<th>Status</th>
										<th></th>
									</tr>
								</thead>
								<tbody>
									<For each={list()}>
										{(inv) => (
											<tr>
												<td class="mono">{inv.number}</td>
												<td class="mono" style={{ "font-weight": "500" }}>
													${inv.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
												</td>
												<td class="muted">{inv.issueDate.toLocaleDateString()}</td>
												<td class="muted">{inv.dueDate ? inv.dueDate.toLocaleDateString() : "—"}</td>
												<td>
													<span class={`badge ${statusBadge[inv.status]}`}>
														{inv.status}
													</span>
												</td>
												<td>
													<div style={{ display: "flex", gap: "8px" }}>
														<Show when={inv.paymentUrl && inv.status !== "paid"}>
															<a
																href={inv.paymentUrl!}
																target="_blank"
																rel="noopener noreferrer"
																class="btn btn-sm btn-primary"
															>
																Pay Now
															</a>
														</Show>
														<Show when={inv.storagePath}>
															<a
																href={`/api/download?path=${encodeURIComponent(inv.storagePath!)}`}
																class="btn btn-sm"
																download=""
															>
																PDF
															</a>
														</Show>
														<Show when={inv.notes}>
															<span class="muted" style={{ "font-size": "12px", "max-width": "200px", display: "block", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
																{inv.notes}
															</span>
														</Show>
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
			</div>
		</PortalLayout>
	);
}
