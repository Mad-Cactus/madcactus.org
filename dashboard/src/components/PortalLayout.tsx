import { A } from "@solidjs/router";
import { For, ParentComponent, Show, createEffect } from "solid-js";

const links = [
	{ href: "/portal", label: "Overview" },
	{ href: "/portal/documents", label: "Documents" },
	{ href: "/portal/invoices", label: "Invoices" },
	{ href: "/portal/api-keys", label: "API Keys" },
];

const PortalLayout: ParentComponent<{ user?: { id?: string; name?: string; email?: string } | null }> = (props) => {
	// Identify user in PostHog once loaded
	createEffect(() => {
		const u = props.user;
		if (u?.id) (window as any).posthog?.identify?.(u.id, { email: u.email });
	});

	function handleLogoutForm(e: Event) {
		(window as any).posthog?.reset?.();
	}
	return (
		<div class="layout">
			<aside class="sidebar">
				<div class="sidebar-logo">
					<img src="/cactus-seal.svg" alt="Mad Cactus" />
					<div class="sidebar-logo-text">
						Mad Cactus
						<small>Client Portal</small>
					</div>
				</div>
				<nav class="sidebar-nav">
					<For each={links}>
						{(link) => (
							<A
								href={link.href}
								end={link.href === "/portal"}
								class="nav-link"
								activeClass="active"
							>
								{link.label}
							</A>
						)}
					</For>
				</nav>
				<div class="sidebar-footer">
					<Show when={props.user?.name}>
						<div style={{ "margin-bottom": "4px" }}>{props.user!.name}</div>
					</Show>
					<Show when={props.user?.email}>
						<div style={{ "font-size": "12px", opacity: "0.6", "margin-bottom": "8px" }}>
							{props.user!.email}
						</div>
					</Show>
					<form method="post" action="/portal/logout" style={{ display: "inline" }} onSubmit={handleLogoutForm}>
						<button type="submit">Sign out</button>
					</form>
				</div>
			</aside>
			<main class="content">{props.children}</main>
		</div>
	);
};

export default PortalLayout;
