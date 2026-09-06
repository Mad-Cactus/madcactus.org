import { A } from "@solidjs/router";
import { For, ParentComponent, Show, createEffect, createSignal, onMount } from "solid-js";
import Timer from "~/components/Timer";
import CommandPalette from "~/components/CommandPalette";
import { FeedbackWidget } from "@aspectrr/feedback-widget";

// Single-path stroke icons (24×24, lucide-style) so the collapsed rail can
// show them without an icon-font dependency.
const links = [
	{ href: "/admin", label: "Dashboard", icon: "M3 3h8v8H3zM13 3h8v5h-8zM13 12h8v9h-8zM3 15h8v6H3z" },
	{ href: "/admin/email", label: "Email", icon: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6" },
	{ href: "/admin/projects", label: "Projects", icon: "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.2 3.9A2 2 0 0 0 7.5 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" },
	{ href: "/admin/companies", label: "Companies", icon: "M4 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18M16 8h2a2 2 0 0 1 2 2v12M2 22h20M8 6h2M8 10h2M8 14h2M12 6h.01M12 10h.01M12 14h.01" },
	{ href: "/admin/meetings", label: "Meetings", icon: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" },
	{ href: "/admin/outreach", label: "Outreach", icon: "M22 2 11 13M22 2l-7 20-4-9-9-4z" },
	{ href: "/admin/videos", label: "Videos", icon: "M23 7l-7 5 7 5V7zM1 5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" },
	{ href: "/admin/docs", label: "Docs", icon: "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5zM14 2v6h6M9 13h6M9 17h6" },
	{ href: "/admin/brain", label: "Brain", icon: "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4" },
	{ href: "/admin/api-keys", label: "API Keys", icon: "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3" },
];

const NavIcon: ParentComponent<{ d: string }> = (p) => (
	<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d={p.d} />
	</svg>
);

const Layout: ParentComponent<{ user?: { id?: string; email?: string } | null }> = (props) => {
	// ponytail: collapsed state loads after mount — SSR always renders expanded,
	// so a saved collapse flashes for one frame. Move to a cookie if that bugs you.
	const [collapsed, setCollapsed] = createSignal(false);
	onMount(() => setCollapsed(localStorage.getItem("sidebar-collapsed") === "1"));

	function toggleCollapsed() {
		const next = !collapsed();
		setCollapsed(next);
		localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
	}

	// Identify user in PostHog once loaded
	createEffect(() => {
		const u = props.user;
		if (u?.id) (window as any).posthog?.identify?.(u.id, { email: u.email });
	});

	function handleLogoutForm(e: Event) {
		(window as any).posthog?.reset?.();
	}

	return (
		<div class="layout" classList={{ collapsed: collapsed() }}>
			<CommandPalette />
			<aside class="sidebar">
				<button
					type="button"
					class="sidebar-collapse"
					title={collapsed() ? "Expand sidebar" : "Collapse sidebar"}
					aria-expanded={!collapsed()}
					onClick={toggleCollapsed}
				>
					{collapsed() ? "›" : "‹"}
				</button>
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
								title={link.label}
							>
								<NavIcon d={link.icon} />
								<span class="nav-label">{link.label}</span>
							</A>
						)}
					</For>
				</nav>
				<Timer />
				<div class="sidebar-hints">
					<div><kbd>⌘K</kbd><span>commands</span></div>
					<div><kbd>g</kbd><kbd>e</kbd><span>email</span><kbd>g</kbd><kbd>d</kbd><span>docs</span></div>
				</div>
				<div class="sidebar-footer">
					<Show when={props.user?.email}>
						<div class="sidebar-email" title={props.user!.email}>{props.user!.email}</div>
					</Show>
					<div class="sidebar-footer-actions">
						<form method="post" action="/admin/logout" style={{ display: "inline" }} onSubmit={handleLogoutForm}>
							<button type="submit" title="Sign out">
								<NavIcon d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
								<span class="nav-label">Sign out</span>
							</button>
						</form>
						<FeedbackWidget source="madcactus-dashboard" server="https://aspectrr-feedback.fly.dev" />
					</div>
				</div>
			</aside>
			<main class="content">{props.children}</main>
		</div>
	);
};

export default Layout;
