import { A } from "@solidjs/router";
import { For, ParentComponent, Show, createEffect, createSignal, onMount } from "solid-js";
import Timer from "~/components/Timer";
import CommandPalette from "~/components/CommandPalette";
import { FeedbackWidget } from "@aspectrr/feedback-widget";

const links = [
	{ href: "/admin", label: "Dashboard", short: "D" },
	{ href: "/admin/email", label: "Email", short: "E" },
	{ href: "/admin/projects", label: "Projects", short: "P" },
	{ href: "/admin/companies", label: "Companies", short: "C" },
	{ href: "/admin/meetings", label: "Meetings", short: "M" },
	{ href: "/admin/outreach", label: "Outreach", short: "O" },
	{ href: "/admin/docs", label: "Docs", short: "Do" },
	{ href: "/admin/brain", label: "Brain", short: "B" },
	{ href: "/admin/api-keys", label: "API Keys", short: "K" },
];

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
								data-short={link.short}
							>
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
							<button type="submit" data-short="⏻" title="Sign out">
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
