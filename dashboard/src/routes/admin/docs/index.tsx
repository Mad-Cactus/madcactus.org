import { Title } from "@solidjs/meta";
import { A, createAsync, useAction } from "@solidjs/router";
import { For, Show, Suspense } from "solid-js";
import Layout from "~/components/Layout";
import { getDocsQuery, createDocAction } from "~/lib/docs-queries";

export default function AdminDocs() {
	const docs = createAsync(() => getDocsQuery(), { deferStream: true });
	const create = useAction(createDocAction);

	return (
		<Layout>
			<Title>Docs — Mad Cactus</Title>
			<div style={{ display: "flex", "align-items": "baseline", gap: "16px" }}>
				<h1 class="page-title">Docs</h1>
				<form
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
			<p class="page-subtitle">CRDT markdown docs — agents write gated, your edits teach</p>

			<Suspense fallback={<div class="muted">Loading…</div>}>
				<Show when={docs()?.length} fallback={<div class="muted">No docs yet.</div>}>
					<For each={docs()}>
						{(d) => (
							<A href={`/admin/docs/${d.id}`} class="card" style={{ display: "block", padding: "16px 20px", "margin-bottom": "10px", "text-decoration": "none" }}>
								<div style={{ "font-size": "15px", "font-weight": 500, color: "var(--text)" }}>{d.title}</div>
								<div class="muted" style={{ "font-size": "13px", "margin-top": "4px" }}>
									{new Date(d.updatedAt).toLocaleString()} · v{d.version}
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
