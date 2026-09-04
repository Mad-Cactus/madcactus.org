import { Title } from "@solidjs/meta";
import { useParams, createAsync } from "@solidjs/router";
import { For, Show, createSignal, onMount } from "solid-js";
import Layout from "~/components/Layout";
import LexicalDocEditor from "~/components/LexicalDocEditor";
import { getDocQuery } from "~/lib/docs-queries";

const Doc = (props: { id: string; doc: NonNullable<Awaited<ReturnType<typeof getDocQuery>>> }) => {
	const doc = () => props.doc;
	const [markdown, setMarkdown] = createSignal("");
	const [status, setStatus] = createSignal("");
	const [shareUrl, setShareUrl] = createSignal("");
	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	// seed once when the doc resource resolves
	onMount(() => {
		const stop = setInterval(() => {
			const d = doc();
			if (d) {
				setMarkdown(d.markdown);
				if (d.shareToken) setShareUrl(`${location.origin}/share/${d.shareToken}`);
				clearInterval(stop);
			}
		}, 50);
	});

	const save = async (id: string, md: string) => {
		setStatus("saving…");
		const res = await fetch(`/api/docs/${id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ markdown: md }),
		});
		setStatus(res.ok ? `saved ${new Date().toLocaleTimeString()}` : "save failed");
	};

	const post = async (id: string, body: Record<string, unknown>) => {
		const res = await fetch(`/api/docs/${id}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		return res.json();
	};

	return (
		<>
			<Title>{doc().title} — Mad Cactus</Title>
			{/* macro-style: slim chrome row, then the title reads as the first
			    line of the document itself */}
			<div class="doc-topbar">
				<span>{status() || `v${doc().version}`}</span>
				<div style={{ flex: 1 }} />
				<button type="button" class="btn btn-sm" onClick={async () => {
					const r = await post(props.id, { op: "share", enabled: !shareUrl() });
					setShareUrl(r.shareToken ? `${location.origin}/share/${r.shareToken}` : "");
				}}>
					{shareUrl() ? "Unshare" : "Share"}
				</button>
				<button type="button" class="btn btn-sm" onClick={() => {
					const blob = new Blob([markdown()], { type: "text/markdown" });
					const a = document.createElement("a");
					a.href = URL.createObjectURL(blob);
					a.download = `${doc().title.replace(/[^\w-]+/g, "-")}.md`;
					a.click();
					URL.revokeObjectURL(a.href);
				}}>
					Export .md
				</button>
				<button type="button" class="btn btn-sm" onClick={async () => {
					await save(props.id, markdown());
					const r = await post(props.id, { op: "finalize" });
					setStatus(r.ok ? "marked final" : r.error);
				}}>
					Mark final
				</button>
			</div>
			<Show when={shareUrl()}>
				<p class="muted doc-share">
					Public: <a href={shareUrl()}>{shareUrl()}</a>
				</p>
			</Show>
			<input
				class="doc-title"
				value={doc().title}
				placeholder="Untitled"
				title="Click to rename"
				onChange={(e) => {
					const v = e.currentTarget.value.trim() || "Untitled";
					if (v !== doc().title) void post(props.id, { op: "rename", title: v });
					else e.currentTarget.value = doc().title;
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.currentTarget.blur();
						// Enter jumps into the body, like macro's title → doc navigation
						document.querySelector<HTMLDivElement>(".doc-editor")?.focus();
					}
				}}
			/>
			<LexicalDocEditor
				markdown={markdown()}
				onMarkdownChange={(md) => {
					// skip the seed-conversion echo (same md) — it would bump the
					// version on every open
					if (md === markdown()) return;
					setMarkdown(md);
					// autosave to the DB, not just local state — a refresh must not
					// lose the doc
					clearTimeout(saveTimer);
					saveTimer = setTimeout(() => void save(props.id, md), 1200);
				}}
				onSave={(md) => save(props.id, md)}
			/>
			<DocHistory id={props.id} />
		</>
	);
};

type VersionRow = { id: string; author: string; chatUuid: string | null; length: number; createdAt: string };

/** Version history + per-version unified diff (agent vs human edits). */
const DocHistory = (props: { id: string }) => {
	const [versions, setVersions] = createSignal<VersionRow[]>([]);
	const [diff, setDiff] = createSignal("");
	const [open, setOpen] = createSignal(false);

	const load = async () => {
		const r = await fetch(`/api/docs/${props.id}/versions`);
		if (r.ok) setVersions((await r.json()).versions);
	};
	onMount(() => void load());

	const showDiff = async (v: VersionRow) => {
		const r = await fetch(`/api/docs/${props.id}/versions?diff=${v.id}`);
		if (r.ok) {
			setDiff((await r.json()).diff);
			setOpen(true);
		}
	};

	return (
		<div class="card" style={{ "margin-top": "16px", padding: "14px 18px" }}>
			<div style={{ display: "flex", "align-items": "baseline", gap: "10px" }}>
				<strong style={{ "font-size": "13px" }}>History</strong>
				<span class="muted" style={{ "font-size": "12px" }}>{versions().length} versions</span>
				<div style={{ flex: 1 }} />
				<button type="button" class="btn btn-sm" onClick={() => setOpen(!open())}>
					{open() ? "Hide" : "Show"}
				</button>
			</div>
			<Show when={open()}>
				<For each={versions().slice().reverse()}>
					{(v) => (
						<div style={{ display: "flex", gap: "10px", "align-items": "baseline", "margin-top": "6px", "font-size": "13px" }}>
							<span style={{ width: "52px", color: v.author === "agent" ? "var(--accent, #a855f7)" : "var(--muted)" }}>
								{v.author}
							</span>
							<span class="muted">{new Date(v.createdAt).toLocaleString()} · {v.length} chars</span>
							<button type="button" class="btn btn-sm" onClick={() => void showDiff(v)}>diff</button>
						</div>
					)}
				</For>
				<Show when={diff()}>
					<pre class="muted" style={{ "font-size": "12px", "white-space": "pre-wrap", "margin-top": "10px", background: "var(--bg-alt, #f6f6f6)", padding: "10px", "border-radius": "6px" }}>{diff()}</pre>
				</Show>
			</Show>
		</div>
	);
};

export default function AdminDocEditor() {
	const params = useParams();
	const doc = createAsync(() => getDocQuery(params.id ?? ""), { deferStream: true });
	return (
		<Layout>
			<Show when={doc()}>
				{(d) => <Doc id={params.id ?? ""} doc={d()} />}
			</Show>
		</Layout>
	);
}
