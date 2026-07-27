import { A, useNavigate } from "@solidjs/router";
import { For, ParentComponent, Show, createEffect, createMemo } from "solid-js";
import { signOut } from "~/lib/session";

const links = [
	{ href: "/admin", label: "Dashboard" },
{ href: "/admin/projects", label: "Projects" },
	{ href: "/admin/clients", label: "Clients" },
];

const Layout: ParentComponent<{ user?: { email?: string } | null }> = (props) => {
	const navigate = useNavigate();

	async function handleLogout() {
		"use server";
		await signOut();
	}

	return (
		<div class="layout">
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
				<div class="sidebar-footer">
					<Show when={props.user?.email}>
						<div style={{ "margin-bottom": "8px" }}>{props.user!.email}</div>
					</Show>
					<form method="post" action="/admin/logout" style={{ display: "inline" }}>
						<button type="submit">Sign out</button>
					</form>
				</div>
			</aside>
			<main class="content">{props.children}</main>
		</div>
	);
};

export default Layout;
