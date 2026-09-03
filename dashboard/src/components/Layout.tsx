import { A } from "@solidjs/router";
import { For, ParentComponent, Show, createEffect } from "solid-js";
import Timer from "~/components/Timer";
import CommandPalette from "~/components/CommandPalette";

const links = [
	{ href: "/admin", label: "Dashboard" },
	{ href: "/admin/email", label: "Email" },
	{ href: "/admin/projects", label: "Projects" },
	{ href: "/admin/companies", label: "Companies" },
	{ href: "/admin/meetings", label: "Meetings" },
	{ href: "/admin/outreach", label: "Outreach" },
	{ href: "/admin/docs", label: "Docs" },
	{ href: "/admin/api-keys", label: "API Keys" },
];

const Layout: ParentComponent<{ user?: { id?: string; email?: string } | null }> = (props) => {
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
			<CommandPalette />
			<aside class="sidebar">
				<div class="sidebar-logo">
					<img src="/cactus-seal.svg" alt="Mad Cactus" />
					<div class="sidebar-logo-text">
						Mad Cactus
						<small>Portal</small>
					</div>
				</div>
				<nav class="sidebar-nav">
					<For each={links}>
						{(link) => (
							<A
								href={link.href}
								end={link.href === "/admin"}
								class="nav-link"
								activeClass="active"
							>
								{link.label}
							</A>
						)}
					</For>
				</nav>
				<Timer />
				<div class="muted" style={{ "font-size": "11px", "margin-top": "10px" }}>
					⌘K commands · g e email · g d docs
				</div>
				<div class="sidebar-footer">
					<Show when={props.user?.email}>
						<div style={{ "margin-bottom": "8px" }}>{props.user!.email}</div>
					</Show>
					<form method="post" action="/admin/logout" style={{ display: "inline" }} onSubmit={handleLogoutForm}>
						<button type="submit">Sign out</button>
					</form>
				</div>
			</aside>
			<main class="content">{props.children}</main>
		</div>
	);
};

export default Layout;
