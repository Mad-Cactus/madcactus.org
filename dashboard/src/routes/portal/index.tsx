import { Title } from "@solidjs/meta";
import { A, createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";
import PortalLayout from "~/components/PortalLayout";
import {
	getClientDashboardQuery,
	getClientUserQuery,
} from "~/lib/client-queries";

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
								<div class="label">Hours Used (This Month)</div>
								<div class="value">
									{d().hoursUsed.toFixed(1)}
									{d().hoursCap ? (
										<span class="unit"> / {d().hoursCap}h cap</span>
									) : (
										<span class="unit"> hrs</span>
									)}
								</div>
							</div>
							<div class="stat-card">
								<div class="label">Documents</div>
								<div class="value">{d().docCount}</div>
							</div>
							<div class="stat-card">
								<div class="label">Open Invoices</div>
								<div class="value">{d().invoiceCount}</div>
							</div>
						</div>

						<Show when={d().hoursCap}>
							<div style={{ "margin-top": "32px" }}>
								<div class="section-heading">Retainer Progress</div>
								<div class="card">
									<div
										style={{
											display: "flex",
											"justify-content": "space-between",
											"align-items": "center",
											"margin-bottom": "4px",
										}}
									>
										<span style={{ "font-size": "14px" }}>Monthly hours</span>
										<span class="mono" style={{ "font-size": "13px" }}>
											{d().hoursUsed.toFixed(1)} / {d().hoursCap}h
										</span>
									</div>
									<div class="progress">
										<div
											class="progress-fill"
											style={{
												width: `${Math.min(100, (d().hoursUsed / d().hoursCap!) * 100)}%`,
											}}
										/>
									</div>
								</div>
							</div>
						</Show>

						<div style={{ "margin-top": "32px" }}>
							<div class="section-heading">Recent Activity</div>
							<div class="card">
								<Show
									when={d().recentEntries.length > 0}
									fallback={<p class="muted">No activity this month.</p>}
								>
									<For each={d().recentEntries.slice(0, 8)}>
										{(entry, i) => (
											<>
												{i() > 0 && <hr style={{ border: "none", "border-top": "1px solid rgba(255,255,255,0.06)", margin: "12px 0" }} />}
												<div style={{ display: "flex", "justify-content": "space-between", "gap": "16px" }}>
													<div>
														<div style={{ "font-size": "14px" }}>{entry.description}</div>
														<div class="muted" style={{ "font-size": "12px" }}>
															{entry.entry_date}
															{!entry.billable && " · Non-billable"}
														</div>
													</div>
													<div class="mono" style={{ "font-size": "13px", "white-space": "nowrap" }}>
														{entry.hours}h
													</div>
												</div>
											</>
										)}
									</For>
								</Show>
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
