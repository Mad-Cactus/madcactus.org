import { Title } from "@solidjs/meta";
import { A, createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";
import PortalLayout from "~/components/PortalLayout";
import {
	getClientDashboardQuery,
	getClientUserQuery,
} from "~/lib/client-queries";
import type { DeliverableStatus } from "~/lib/supabase";

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
			<h1 class="page-title">{data()?.project?.name ?? "Loading…"}</h1>
			<p class="page-subtitle">
				{data()?.project?.client_name} ·{" "}
				<span style={{ "text-transform": "capitalize" }}>
					{data()?.project?.engagement_type}
				</span>{" "}
				· ${data()?.project?.hourly_rate}/hr
			</p>

			<Show when={data()}>
				{(d) => (
					<>
						<div class="stat-grid">
							<div class="stat-card">
								<div class="label">Deliverables</div>
								<div class="value">{d().deliverables.length}</div>
							</div>
							<div class="stat-card">
								<div class="label">Completed</div>
								<div class="value">
									{d().deliverables.filter((x) => x.status === "completed").length}
									<span class="unit"> / {d().deliverables.length}</span>
								</div>
							</div>
							<div class="stat-card">
								<div class="label">Open Invoices</div>
								<div class="value">{d().invoiceCount}</div>
							</div>
						</div>

						<div style={{ "margin-top": "32px" }}>
							<div class="section-heading">Deliverables</div>
							<div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
								<For each={d().deliverables}>
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
																	{new Date(upd.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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
