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
	onMount(() => {
		void refresh();
		// last-used builder values — next post only needs a new campaign
		try {
			const s = JSON.parse(localStorage.getItem("link-builder") ?? "{}") as Record<string, string>;
			const form = document.getElementById("link-form") as HTMLFormElement | null;
			if (!form) return;
			for (const k of ["dest", "source", "medium", "campaign"])
				if (s[k]) (form.elements.namedItem(k) as HTMLInputElement).value = s[k];
		} catch {}
	});

	async function save(e: Event) {
		e.preventDefault();
		setError("");
		setMsg("");
		const fd = new FormData(e.target as HTMLFormElement);
		const str = (k: string) => String(fd.get(k) ?? "").trim();
		// full-URL override wins; otherwise compose destination + UTMs
		let target = str("target");
		if (!target) {
			let dest = str("dest");
			if (dest && !dest.includes("://")) dest = `https://${dest}`;
			const q = new URLSearchParams();
			const source = str("source");
			const medium = str("medium");
			const campaign = str("campaign");
			if (source) q.set("utm_source", source);
			if (medium) q.set("utm_medium", medium);
			if (campaign) q.set("utm_campaign", campaign);
			const qs = q.toString();
			target = qs ? `${dest}${dest.includes("?") ? "&" : "?"}${qs}` : dest;
		}
		try {
			localStorage.setItem(
				"link-builder",
				JSON.stringify({ dest: str("dest"), source: str("source"), medium: str("medium"), campaign: str("campaign") }),
			);
		} catch {}
		const r = await fetch("/api/links", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ slug: fd.get("slug"), target }),
		});
		const body = (await r.json()) as { error?: string; slug?: string };
		if (!r.ok) return setError(body.error ?? "Save failed");
		setMsg(`Saved — share link: ${location.origin}/l/${body.slug}`);
		await refresh();
		(e.target as HTMLFormElement).reset();
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

			<details open style={{ "margin-bottom": "24px" }}>
				<summary style={{ cursor: "pointer", "font-weight": "600" }}>Create or update a link</summary>
				<form id="link-form" onSubmit={save} style={{ display: "grid", gap: "8px", "max-width": "640px", "margin-top": "12px" }}>
					<label style={{ display: "grid", gap: "4px" }}>
						Slug — optional, leave blank for an unguessable one
						<input name="slug" placeholder="e.g. td2 — or blank for random" style={{ padding: "8px" }} />
					</label>
					<label style={{ display: "grid", gap: "4px" }}>
						Destination page
						<input name="dest" value="https://madcactus.org/newsletter" style={{ padding: "8px" }} />
					</label>
					<div style={{ display: "grid", "grid-template-columns": "1fr 1fr 1fr", gap: "8px" }}>
						<label style={{ display: "grid", gap: "4px" }}>
							Source
							<input name="source" value="linkedin" style={{ padding: "8px" }} />
						</label>
						<label style={{ display: "grid", gap: "4px" }}>
							Medium
							<input name="medium" value="social" style={{ padding: "8px" }} />
						</label>
						<label style={{ display: "grid", gap: "4px" }}>
							Campaign
							<input name="campaign" placeholder="td2" style={{ padding: "8px" }} />
						</label>
					</div>
					<details>
						<summary style={{ cursor: "pointer", "font-size": "13px" }}>Or paste a full target URL (UTMs included) instead</summary>
						<input name="target" placeholder="https://…?utm_source=…" style={{ padding: "8px", width: "100%", "margin-top": "8px" }} />
					</details>
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
