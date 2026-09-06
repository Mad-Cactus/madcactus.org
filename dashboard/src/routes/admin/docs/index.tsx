import { Title } from "@solidjs/meta";
import { A, createAsync, useAction } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import Layout from "~/components/Layout";
import { getDocsQuery, createDocAction } from "~/lib/docs-queries";

const FILTERS = [
	{ key: "all", label: "All" },
	{ key: "post", label: "Posts" },
	{ key: "newsletter", label: "Newsletters" },
	{ key: "doc", label: "Plain docs" },
] as const;

export default function AdminDocs() {
	const docs = createAsync(() => getDocsQuery(), { deferStream: true });
	const create = useAction(createDocAction);
	const [filter, setFilter] = createSignal<(typeof FILTERS)[number]["key"]>("all");

	return (
		<Layout>
			<Title>Docs — Mad Cactus</Title>
			<div style={{ display: "flex", "align-items": "baseline", gap: "16px" }}>
				<h1 class="page-title">Docs</h1>
				<form
					style={{ display: "flex", gap: "8px", "align-items": "center" }}
					onSubmit={(e) => {
						e.preventDefault();
						const fd = new FormData(e.currentTarget);
						create(fd);
						(e.currentTarget as HTMLFormElement).reset();
					}}
				>
					<input name="title" placeholder="New doc title…" style={{ width: "220px" }} />
					<button type="submit" class="btn btn-primary btn-sm">Create</button>
				</form>
			</div>
			<p class="page-subtitle">Markdown docs with full version history — agents write, your edits teach</p>

			<div style={{ display: "flex", gap: "6px", "margin-bottom": "14px" }}>
				<For each={FILTERS}>
					{(f) => (
						<button type="button" class="btn btn-sm" classList={{ active: filter() === f.key }} onClick={() => setFilter(f.key)}>
							{f.label}
						</button>
					)}
				</For>
			</div>

			<Suspense fallback={<div class="muted">Loading…</div>}>
				<Show when={docs()?.length} fallback={<div class="muted">No docs yet.</div>}>
					<For each={docs()?.filter((d) => filter() === "all" || (filter() === "doc" ? !d.kind : d.kind === filter()))}>
						{(d) => (
							<A href={`/admin/docs/${d.id}`} class="card" style={{ display: "block", padding: "16px 20px", "margin-bottom": "10px", "text-decoration": "none" }}>
								<div style={{ "font-size": "15px", "font-weight": 500, color: "var(--text)" }}>{d.title}</div>
								<div class="muted" style={{ "font-size": "13px", "margin-top": "4px" }}>
									{new Date(d.updatedAt).toLocaleString()} · v{d.version}
									<Show when={d.kind}> · {d.kind === "post" ? "post" : "newsletter"}</Show>
									<Show when={d.status === "draft"}> · <span style={{ color: "var(--accent, #a855f7)" }}>agent write awaiting review</span></Show>
									<Show when={d.status === "scheduled" && d.scheduledFor}> · <span style={{ color: "var(--accent, #a855f7)" }}>scheduled {new Date(d.scheduledFor!).toLocaleString()}</span></Show>
									<Show when={d.status === "published"}> · <span style={{ color: "var(--good, #22c55e)" }}>published</span></Show>
									<Show when={d.status === "failed"}> · <span style={{ color: "var(--bad, #ef4444)" }}>publish failed</span></Show>
									<Show when={d.shareToken}> · shared</Show>
								</div>
							</A>
						)}
					</For>
				</Show>
			</Suspense>
		</Layout>
	);
}
