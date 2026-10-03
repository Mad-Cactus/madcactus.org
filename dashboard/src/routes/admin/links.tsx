import { Title } from "@solidjs/meta";
import { createAsync } from "@solidjs/router";
import { For, Show, createSignal, onMount } from "solid-js";
import ConfirmButton from "~/components/ConfirmButton";
import CreateDialog from "~/components/CreateDialog";
import Layout from "~/components/Layout";
import { getUserQuery } from "~/lib/queries";

type Link = { slug: string; target: string; clicks: number; docId: string | null; docTitle: string | null; docKind: string | null; createdAt: string };
type Doc = { id: string; title: string; kind: string; publishedAt: string | null };

const docHref = (id: string, kind: string | null) =>
	kind === "newsletter" ? `/admin/newsletters/${id}` : `/admin/posts/${id}`;

// Short links — clean /l/<slug> URLs for LinkedIn first comments etc.; the
// UTMs (and click counts) live behind the redirect, not in the visible link.
export default function AdminLinks() {
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const [links, setLinks] = createSignal<Link[]>([]);
	const [docOptions, setDocOptions] = createSignal<Doc[]>([]);

	async function refresh() {
		const r = await fetch("/api/links");
		if (r.ok) {
			const body = (await r.json()) as { links: Link[]; docs: Doc[] };
			setLinks(body.links);
			setDocOptions(body.docs);
		}
	}
	onMount(() => {
		void refresh();
		// last-used builder values — next post only needs a new campaign. The
		// form lives inside the create dialog now; find it via its dest field.
		try {
			const s = JSON.parse(localStorage.getItem("link-builder") ?? "{}") as Record<string, string>;
			const form = document.querySelector<HTMLInputElement>('input[name="dest"]')?.form ?? null;
			if (!form) return;
			for (const k of ["dest", "source", "medium", "campaign"])
				if (s[k]) (form.elements.namedItem(k) as HTMLInputElement).value = s[k];
		} catch {}
	});

	/** Builds + saves the link; returns { error } or { success } (CreateDialog
	 *  toasts the /l/<slug> share URL). */
	async function save(form: HTMLFormElement): Promise<{ error?: string; success?: string }> {
		const fd = new FormData(form);
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
			body: JSON.stringify({ target, docId: str("docId") || null }),
		});
		const body = (await r.json()) as { error?: string; slug?: string };
		if (!r.ok) return { error: body.error ?? "Save failed" };
		await refresh();
		return { success: `Saved — share link: ${location.origin}/l/${body.slug}` };
	}

	async function remove(slug: string) {
		const r = await fetch(`/api/links?slug=${encodeURIComponent(slug)}`, { method: "DELETE" });
		if (!r.ok) return { error: ((await r.json()) as { error?: string }).error ?? "Delete failed" };
		await refresh();
	}

	const [copied, setCopied] = createSignal("");
	async function copyLink(l: Link) {
		await navigator.clipboard.writeText(`${location.origin}/l/${l.slug}`);
		setCopied(l.slug);
		setTimeout(() => setCopied(""), 1200);
	}

	// edit dialog — native <dialog>, no modal lib
	const [editing, setEditing] = createSignal<{ slug: string; target: string; docId: string } | null>(null);
	const [editError, setEditError] = createSignal("");
	let dialogRef: HTMLDialogElement | undefined;

	function openEdit(l: Link) {
		setEditing({ slug: l.slug, target: l.target, docId: l.docId ?? "" });
		setEditError("");
		dialogRef?.showModal();
	}

	async function saveEdit(e: Event) {
		e.preventDefault();
		const cur = editing();
		if (!cur) return;
		const fd = new FormData(e.target as HTMLFormElement);
		const docId = String(fd.get("docId") ?? "").trim();
		const r = await fetch("/api/links", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				slug: cur.slug,
				target: String(fd.get("target") ?? "").trim(),
				docId: docId || null,
			}),
		});
		const body = (await r.json()) as { error?: string };
		if (!r.ok) return setEditError(body.error ?? "Save failed");
		dialogRef?.close();
		setEditing(null);
		await refresh();
	}

	return (
		<Layout user={user()}>
			<Title>Links — Mad Cactus</Title>
			<h1 class="page-title" style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "gap": "16px", "margin-bottom": "4px" }}>
				Short Links
				<CreateDialog label="Create a link" title="Create a link" submitLabel="Save link" onSubmit={(_fd, form) => save(form)}>
					<div class="form-group">
						<label for="link_dest">Destination page</label>
						<input id="link_dest" name="dest" value="https://madcactus.org/newsletter" spellcheck={false} />
					</div>
					<div class="form-row">
						<div class="form-group">
							<label for="link_source">Source</label>
							<input id="link_source" name="source" value="linkedin" spellcheck={false} />
						</div>
						<div class="form-group">
							<label for="link_medium">Medium</label>
							<input id="link_medium" name="medium" value="social" spellcheck={false} />
						</div>
						<div class="form-group">
							<label for="link_campaign">Campaign</label>
							<input id="link_campaign" name="campaign" placeholder="td2" spellcheck={false} />
						</div>
					</div>
					<details style={{ "margin-bottom": "16px" }}>
						<summary class="muted" style={{ cursor: "pointer", "font-size": "13px" }}>Or paste a full target URL (UTMs included) instead</summary>
						<div class="form-group" style={{ "margin-top": "8px" }}>
							<label for="link_target">Full target URL</label>
							<input id="link_target" name="target" placeholder="https://…?utm_source=…" spellcheck={false} />
						</div>
					</details>
					<div class="form-group">
						<label for="link_doc">Attached post / newsletter</label>
						<select id="link_doc" name="docId">
							<option value="">— none (standalone link) —</option>
							<For each={docOptions()}>
								{(d) => (
									<option value={d.id}>
										{d.kind}: {d.title}
									</option>
								)}
							</For>
						</select>
					</div>
				</CreateDialog>
			</h1>
			<p class="page-subtitle">
				Clean /l/&lt;slug&gt; URLs for first comments and posts — UTMs hide behind the redirect, clicks count per link.
			</p>

			<table style={{ width: "100%", "border-collapse": "collapse" }}>
				<thead>
					<tr style={{ "text-align": "left", "border-bottom": "1px solid #ddd" }}>
						<th style={{ padding: "8px" }}>Link</th>
						<th style={{ padding: "8px" }}>Target</th>
						<th style={{ padding: "8px" }}>Attached to</th>
						<th style={{ padding: "8px" }}>Clicks</th>
						<th style={{ padding: "8px" }} />
					</tr>
				</thead>
				<tbody>
					<For each={links()}>
						{(l) => (
							<tr style={{ "border-bottom": "1px solid #eee" }}>
								<td style={{ padding: "8px" }}>
									<code>{l.slug}</code>
								</td>
								<td style={{ padding: "8px", "max-width": "420px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{l.target}</td>
								<td style={{ padding: "8px" }}>
									<Show
										when={l.docId && l.docTitle}
										fallback={<span class="muted" style={{ "font-size": "13px" }}>—</span>}
									>
										<a href={docHref(l.docId!, l.docKind)}>{l.docTitle}</a>
									</Show>
								</td>
								<td style={{ padding: "8px", "font-variant-numeric": "tabular-nums" }}>{l.clicks}</td>
								<td style={{ padding: "8px" }}>
									<span style={{ display: "inline-flex", gap: "6px", "align-items": "center" }}>
									<button type="button" class="btn btn-sm" onClick={() => void copyLink(l)}>
										{copied() === l.slug ? "Copied" : "Copy link"}
									</button>
									<button type="button" class="btn btn-sm" onClick={() => openEdit(l)}>Edit</button>
									<ConfirmButton label="Delete" danger onConfirm={() => remove(l.slug)} />
								</span>
								</td>
							</tr>
						)}
					</For>
				</tbody>
			</table>

			<dialog
				ref={dialogRef}
				onClose={() => setEditing(null)}
				style={{ border: "1px solid #ddd", padding: "24px", "min-width": "440px", "max-width": "90vw" }}
			>
				<Show when={editing()}>
					<h2 style={{ margin: "0 0 12px", "font-size": "18px" }}>Edit link</h2>
					<form onSubmit={saveEdit} style={{ display: "grid", gap: "8px" }}>
						<label style={{ display: "grid", gap: "4px" }}>
							Target URL
							<input name="target" value={editing()!.target} required style={{ padding: "8px" }} spellcheck={false} />
						</label>
						<label style={{ display: "grid", gap: "4px" }}>
							Attached post / newsletter
							<select name="docId" style={{ padding: "8px" }}>
								<option value="">— none (standalone link) —</option>
								<For each={docOptions()}>
									{(d) => (
										<option value={d.id} selected={d.id === editing()!.docId}>
											{d.kind}: {d.title}
										</option>
									)}
								</For>
							</select>
						</label>
						<Show when={editError()}>
							<p style={{ color: "#b91c1c" }}>{editError()}</p>
						</Show>
						<div style={{ display: "flex", gap: "8px", "justify-content": "flex-end", "margin-top": "4px" }}>
							<button type="button" class="btn btn-sm" onClick={() => dialogRef?.close()}>Cancel</button>
							<button type="submit" class="btn btn-sm btn-primary">Save</button>
						</div>
					</form>
				</Show>
			</dialog>
		</Layout>
	);
}
