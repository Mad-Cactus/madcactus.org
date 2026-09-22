import { A, createAsync, useAction } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import { getDocsQuery, createDocAction, getIssueStatsQuery, addIssueLearningAction } from "~/lib/docs-queries";

/** Shared list for the three doc tabs — same table, filtered by kind. */
export default function DocList(props: {
	kind: "post" | "newsletter" | null;
	title: string;
	subtitle: string;
	createPlaceholder: string;
}) {
	const docs = createAsync(() => getDocsQuery(), { deferStream: true });
	const stats = createAsync(() => getIssueStatsQuery(), { deferStream: true });
	const create = useAction(createDocAction);
	const [creating, setCreating] = createSignal(false);
	const [genre, setGenre] = createSignal("");

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
					{/* genre is freeform (the voice engine learns new ones) — plain input
					    plus tap-to-fill chips. The native <datalist> popup rendered
					    detached from the input on macOS, so it's gone. */}
					<div>
						<input
							name="genre"
							placeholder="genre (optional)"
							style={{ width: "200px" }}
							value={genre()}
							onInput={(e) => setGenre(e.currentTarget.value)}
						/>
						<div style={{ display: "flex", gap: "6px", "margin-top": "6px" }}>
							<For each={["marketing", "informational", "casual"]}>
								{(g) => (
									<button
										type="button"
										class="btn btn-sm"
										style={{ padding: "2px 10px", "font-size": "12px", opacity: genre() === g ? 1 : 0.7 }}
										onClick={() => setGenre(g)}
									>
										{g}
									</button>
								)}
							</For>
						</div>
					</div>
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
							<div class="card" style={{ padding: "16px 20px", "margin-bottom": "10px" }}>
								<A href={`/admin/${props.kind ? `${props.kind}s` : "docs"}/${d.id}`} style={{ display: "block", "text-decoration": "none" }}>
									<div style={{ "font-size": "15px", "font-weight": 500, color: "var(--text)" }}>{d.title}</div>
								<div class="muted" style={{ "font-size": "13px", "margin-top": "4px" }}>
									{new Date(d.updatedAt).toLocaleString()} · v{d.version}
									<Show when={d.genre}> · {d.genre}</Show>
									<Show when={d.status === "draft"}> · <span style={{ color: "var(--accent, #a855f7)" }}>agent write awaiting review</span></Show>
									<Show when={d.status === "scheduled" && d.scheduledFor}> · <span style={{ color: "var(--accent, #a855f7)" }}>scheduled {new Date(d.scheduledFor!).toLocaleString()}</span></Show>
									<Show when={d.status === "published"}> · <span style={{ color: "var(--good, #22c55e)" }}>published</span></Show>
									<Show when={d.status === "final" && d.publishedAt}> · was {props.kind === "newsletter" ? "sent" : "posted"} {new Date(d.publishedAt!).toLocaleDateString()} · marked unposted</Show>
									<Show when={d.status === "failed"}> · <span style={{ color: "var(--bad, #ef4444)" }}>publish failed</span></Show>
									<Show when={d.shareToken}> · shared</Show>
								</div>
								</A>
								<Show when={props.kind === "newsletter" && d.status === "published"}>
									<div class="muted" style={{ "font-size": "12px", "margin-top": "4px" }}>
										{d.opens} opens · {stats()?.clicksByDoc[d.id] ?? 0} short-link clicks · {stats()?.requestsByDoc[d.id] ?? 0} brain requests
									</div>
									<AddLearning docId={d.id} />
								</Show>
							</div>
						)}
					</For>
				</Show>
			</Suspense>
		</>
	);
}

// Topic-tagged lesson from a sent issue's numbers — feeds the next draft via
// get_voice_lessons(topic=…). Kept tiny: one input + topic select.
function AddLearning(props: { docId: string }) {
	const add = useAction(addIssueLearningAction);
	const [msg, setMsg] = createSignal("");
	return (
		<details style={{ "margin-top": "6px" }}>
			<summary class="muted" style={{ cursor: "pointer", "font-size": "12px" }}>Add learning</summary>
			<form
				style={{ display: "flex", gap: "6px", "margin-top": "6px", "flex-wrap": "wrap" }}
				onSubmit={async (e) => {
					e.preventDefault();
					const form = e.currentTarget as HTMLFormElement;
					const res = (await add(new FormData(form))) as { error?: string; ok?: boolean };
					if (res.error) setMsg(res.error);
					else {
						setMsg("Saved.");
						form.reset();
					}
				}}
			>
				<select name="topic" class="doc-sched-input" style={{ width: "90px" }}>
					<option value="subject">subject</option>
					<option value="cta">cta</option>
				</select>
				<input type="hidden" name="doc_id" value={props.docId} />
				<input name="fact" placeholder="e.g. question subjects beat statement subjects, 41% vs 28% opens" style={{ flex: 1, "min-width": "260px" }} />
				<button type="submit" class="btn btn-sm">Save</button>
			</form>
			<Show when={msg()}><span class="muted" style={{ "font-size": "12px" }}>{msg()}</span></Show>
		</details>
	);
}
