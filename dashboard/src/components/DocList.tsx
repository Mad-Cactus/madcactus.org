import { A, createAsync, useAction } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import { getDocsQuery, createDocAction } from "~/lib/docs-queries";

/** Shared list for the three doc tabs — same table, filtered by kind. */
export default function DocList(props: {
	kind: "post" | "newsletter" | null;
	title: string;
	subtitle: string;
	createPlaceholder: string;
}) {
	const docs = createAsync(() => getDocsQuery(), { deferStream: true });
	const create = useAction(createDocAction);
	const [creating, setCreating] = createSignal(false);

	return (
		<>
			<div style={{ display: "flex", "align-items": "baseline", gap: "16px" }}>
				<h1 class="page-title">{props.title}</h1>
				<button type="button" class="btn btn-primary btn-sm" onClick={() => setCreating((c) => !c)}>
					{creating() ? "Cancel" : "New"}
				</button>
			</div>
			<p class="page-subtitle">{props.subtitle}</p>

			<Show when={creating()}>
				<form
					style={{ display: "flex", gap: "8px", "align-items": "center", "margin-bottom": "14px" }}
					onSubmit={(e) => {
						e.preventDefault();
						const fd = new FormData(e.currentTarget);
						create(fd);
					}}
				>
					<input name="title" placeholder={props.createPlaceholder} style={{ width: "260px" }} autofocus />
					<input name="genre" placeholder="genre (marketing, informational…)" list="doc-genres" style={{ width: "200px" }} />
					<datalist id="doc-genres">
						<option value="marketing" />
						<option value="informational" />
						<option value="casual" />
					</datalist>
					<input type="hidden" name="kind" value={props.kind ?? ""} />
					<button type="submit" class="btn btn-sm">Create</button>
				</form>
			</Show>

			<Suspense fallback={<div class="muted">Loading…</div>}>
				<Show
					when={docs()?.filter((d) => d.kind === props.kind).length}
					fallback={<div class="muted">Nothing here yet.</div>}
				>
					<For each={docs()?.filter((d) => d.kind === props.kind)}>
						{(d) => (
							<A href={`/admin/docs/${d.id}`} class="card" style={{ display: "block", padding: "16px 20px", "margin-bottom": "10px", "text-decoration": "none" }}>
								<div style={{ "font-size": "15px", "font-weight": 500, color: "var(--text)" }}>{d.title}</div>
								<div class="muted" style={{ "font-size": "13px", "margin-top": "4px" }}>
									{new Date(d.updatedAt).toLocaleString()} · v{d.version}
									<Show when={d.genre}> · {d.genre}</Show>
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
		</>
	);
}
