import { Title } from "@solidjs/meta";
import { createAsync } from "@solidjs/router";
import { For, Show, createSignal, onMount } from "solid-js";
import Layout from "~/components/Layout";
import { getUserQuery } from "~/lib/queries";

type Link = { slug: string; target: string; clicks: number; createdAt: string };

// Short links — clean /l/<slug> URLs for LinkedIn first comments etc.; the
// UTMs (and click counts) live behind the redirect, not in the visible link.
export default function AdminLinks() {
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const [links, setLinks] = createSignal<Link[]>([]);
	const [error, setError] = createSignal("");
	const [msg, setMsg] = createSignal("");

	async function refresh() {
		const r = await fetch("/api/links");
		if (r.ok) setLinks((await r.json()) as Link[]);
	}
	onMount(() => void refresh());

	async function save(e: Event) {
		e.preventDefault();
		setError("");
		setMsg("");
		const fd = new FormData(e.target as HTMLFormElement);
		const r = await fetch("/api/links", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slug: fd.get("slug"), target: fd.get("target") }),
		});
		const body = (await r.json()) as { error?: string };
		if (!r.ok) return setError(body.error ?? "Save failed");
		setMsg("Saved.");
		await refresh();
	}

	async function remove(slug: string) {
		await fetch(`/api/links?slug=${encodeURIComponent(slug)}`, { method: "DELETE" });
		await refresh();
	}

	return (
		<Layout user={user()}>
			<Title>Links — Mad Cactus</Title>
			<h1 class="page-title">Short Links</h1>
			<p class="page-subtitle">
				Clean /l/&lt;slug&gt; URLs for first comments and posts — UTMs hide behind the redirect, clicks count per link.
			</p>

			<details style={{ "margin-bottom": "24px" }}>
				<summary style={{ cursor: "pointer", "font-weight": "600" }}>Create or update a link</summary>
				<form onSubmit={save} style={{ display: "grid", gap: "8px", "max-width": "640px", "margin-top": "12px" }}>
					<label style={{ display: "grid", gap: "4px" }}>
						Slug (the /l/… part)
						<input name="slug" required placeholder="td1-p1" style={{ padding: "8px" }} />
					</label>
					<label style={{ display: "grid", gap: "4px" }}>
						Target URL (UTMs go here)
						<input name="target" required placeholder="https://madcactus.org/newsletter?utm_source=linkedin&utm_medium=social&utm_campaign=td1" style={{ padding: "8px" }} />
					</label>
					<Show when={error()}>
						<p style={{ color: "#b91c1c" }}>{error()}</p>
					</Show>
					<button type="submit" style={{ padding: "8px 16px", cursor: "pointer" }}>Save link</button>
				</form>
			</details>

			<Show when={msg()}>
				<p class="muted">{msg()}</p>
			</Show>

			<table style={{ width: "100%", "border-collapse": "collapse" }}>
				<thead>
					<tr style={{ "text-align": "left", "border-bottom": "1px solid #ddd" }}>
						<th style={{ padding: "8px" }}>Link</th>
						<th style={{ padding: "8px" }}>Target</th>
						<th style={{ padding: "8px" }}>Clicks</th>
						<th style={{ padding: "8px" }} />
					</tr>
				</thead>
				<tbody>
					<For each={links()}>
						{(l) => (
							<tr style={{ "border-bottom": "1px solid #eee" }}>
								<td style={{ padding: "8px" }}>
									<code>/l/{l.slug}</code>
								</td>
								<td style={{ padding: "8px", "max-width": "420px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{l.target}</td>
								<td style={{ padding: "8px", "font-variant-numeric": "tabular-nums" }}>{l.clicks}</td>
								<td style={{ padding: "8px" }}>
									<button type="button" onClick={() => void remove(l.slug)} style={{ cursor: "pointer" }}>Delete</button>
								</td>
							</tr>
						)}
					</For>
				</tbody>
			</table>
		</Layout>
	);
}
