import { Title } from "@solidjs/meta";
import { A, createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";
import PortalLayout from "~/components/PortalLayout";
import {
	getClientDashboardQuery,
	getClientUserQuery,
} from "~/lib/client-queries";
import type { DeliverableStatus } from "~/db/schema";

const statusBadge: Record<DeliverableStatus, string> = {
	planned: "badge-paused",
	in_progress: "badge-active",
	review: "badge-active",
	completed: "badge-completed",
	blocked: "badge-paused",
};

export default function PortalHome() {
	const user = createAsync(() => getClientUserQuery(), { deferStream: true });
	const data = createAsync(() => getClientDashboardQuery(), {
		deferStream: true,
	});

	return (
		<PortalLayout user={user()}>
			<Title>Overview — Mad Cactus Client Portal</Title>
			<h1 class="page-title">Projects</h1>
			<p class="page-subtitle">All engagements across your companies</p>

			<Show when={data()}>
				{(d) => (
					<>
						<div class="stat-grid">
							<div class="stat-card">
								<div class="label">Projects</div>
								<div class="value">{d().projects.length}</div>
							</div>
							<div class="stat-card">
								<div class="label">Deliverables</div>
								<div class="value">{d().deliverables.length}</div>
							</div>
							<div class="stat-card">
								<div class="label">Open Invoices</div>
								<div class="value">{d().invoiceCount}</div>
							</div>
						</div>

						{/* ── Projects list ────────────────────────── */}
						<div style={{ "margin-top": "32px" }}>
							<div class="section-heading">Projects</div>
							<div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
								<For each={d().projects} fallback={<div class="card empty">No projects yet.</div>}>
									{(proj) => (
										<div class="card" style={{ padding: "20px" }}>
											<div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
												<div>
													<span style={{ "font-size": "15px", "font-weight": "500" }}>{proj.name}</span>
													<span class="muted" style={{ "font-size": "13px", "margin-left": "8px" }}>{proj.companyName}</span>
												</div>
												<span style={{ "text-transform": "capitalize", "font-size": "13px" }} class="muted">
													{proj.engagementType === "project"
														? `$${(proj.fixedPrice ?? 0).toLocaleString()} fixed`
														: `$${proj.hourlyRate}/hr`}
												</span>
											</div>
										</div>
									)}
								</For>
							</div>
						</div>

						{/* ── Deliverables ─────────────────────────── */}
						<div style={{ "margin-top": "32px" }}>
							<div class="section-heading">Deliverables</div>
							<div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
								<For each={d().deliverables} fallback={<div class="card empty">No deliverables yet.</div>}>
									{(delv) => (
										<div class="card" style={{ padding: "20px" }}>
											<div style={{ display: "flex", "justify-content": "space-between", "align-items": "flex-start", gap: "12px" }}>
												<div>
													<span style={{ "font-size": "15px", "font-weight": "500" }}>{delv.title}</span>
													<span class={`badge ${statusBadge[delv.status]}`} style={{ "margin-left": "8px", "text-transform": "capitalize" }}>
														{delv.status.replace("_", " ")}
													</span>
												</div>
											</div>
											<Show when={delv.description}>
												<p class="muted" style={{ "font-size": "13px", "margin-top": "6px" }}>{delv.description}</p>
											</Show>

											<Show when={delv.updates.length > 0}>
												<div style={{ "margin-top": "12px", "padding-left": "12px", "border-left": "2px solid rgba(188,156,92,0.3)" }}>
													<For each={delv.updates}>
														{(upd) => (
															<div style={{ "margin-bottom": "8px" }}>
																<div class="muted" style={{ "font-size": "11px" }}>
																	{new Date(upd.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
																</div>
																<div style={{ "font-size": "13px", "line-height": "1.5" }}>{upd.body}</div>
															</div>
														)}
													</For>
												</div>
											</Show>
										</div>
									)}
								</For>
							</div>
						</div>

						<div style={{ "margin-top": "24px", display: "flex", gap: "12px" }}>
							<A href="/portal/documents" class="btn">View Documents</A>
							<A href="/portal/invoices" class="btn">View Invoices</A>
							<A href="/portal/api-keys" class="btn">API Keys</A>
						</div>
					</>
				)}
			</Show>
		</PortalLayout>
	);
}
