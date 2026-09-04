import { Title } from "@solidjs/meta";
import { useParams, createAsync } from "@solidjs/router";
import { For, Show, createSignal, onMount } from "solid-js";
import Layout from "~/components/Layout";
import LexicalDocEditor from "~/components/LexicalDocEditor";
import { getDocQuery } from "~/lib/docs-queries";

type VersionRow = {
	id: string;
	version: number;
	author: string;
	createdAt: string;
	updatedAt: string;
};
type DiffPart = { added?: boolean; removed?: boolean; value: string };

const Doc = (props: { id: string; doc: NonNullable<Awaited<ReturnType<typeof getDocQuery>>> }) => {
	const doc = () => props.doc;
	const [markdown, setMarkdown] = createSignal("");
	const [status, setStatus] = createSignal("");
	const [shareUrl, setShareUrl] = createSignal("");
	const [verNum, setVerNum] = createSignal(doc().version);
	const [showHistory, setShowHistory] = createSignal(false);
	const [versions, setVersions] = createSignal<VersionRow[]>([]);
	const [sel, setSel] = createSignal<number | null>(null);
	const [diff, setDiff] = createSignal<DiffPart[] | null>(null);
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

	const loadVersions = async () => {
		const r = await fetch(`/api/docs/${props.id}?versions=1`);
		if (r.ok) setVersions(((await r.json()) as { versions: VersionRow[] }).versions);
	};

	const openVersion = async (v: number) => {
		setSel(v);
		setDiff(null);
		const r = await fetch(`/api/docs/${props.id}?diff=${v}`);
		if (r.ok) setDiff(((await r.json()) as { parts: DiffPart[] }).parts);
	};

	const toggleHistory = () => {
		const next = !showHistory();
		setShowHistory(next);
		if (next) void loadVersions();
	};

	const save = async (id: string, md: string) => {
		setStatus("saving…");
		const res = await fetch(`/api/docs/${id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ markdown: md }),
		});
		if (res.ok) {
			setVerNum(((await res.json()) as { version: number }).version);
			setStatus(`saved ${new Date().toLocaleTimeString()}`);
			if (showHistory()) void loadVersions();
		} else {
			setStatus("save failed");
		}
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
			<div class="doc-shell">
				<div class="doc-main">
			{/* macro-style: slim chrome row, then the title reads as the first
			    line of the document itself */}
			<div class="doc-topbar">
				<span>{status() || `v${verNum()}`}</span>
				<div style={{ flex: 1 }} />
				<button type="button" class="btn btn-sm" classList={{ active: showHistory() }} onClick={toggleHistory}>
					History
				</button>
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
				<button type="button" class="btn btn-primary btn-sm" onClick={async () => {
					await save(props.id, markdown());
					const r = await post(props.id, { op: "finalize" });
					setStatus(r.pairId ? `finalized → pair ${r.pairId.slice(0, 8)}` : r.error);
				}}>
					Finalize
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
				</div>
				<Show when={showHistory()}>
					<aside class="doc-history">
						<div class="doc-history-head">History</div>
						<Show when={versions().length} fallback={<p class="muted">No saved versions yet.</p>}>
							<For each={versions()}>
								{(v) => (
									<button
										type="button"
										class="doc-history-row"
										classList={{ active: sel() === v.version }}
										onClick={() => void openVersion(v.version)}
									>
										<span class="doc-history-ver">v{v.version}</span>
										<span class="doc-history-author" classList={{ agent: v.author === "agent" }}>
											{v.author}
										</span>
										<span class="muted">{new Date(v.updatedAt).toLocaleString()}</span>
									</button>
								)}
							</For>
						</Show>
						<Show when={sel() !== null}>
							<div class="doc-diff">
								<Show when={diff()} fallback={<p class="muted">Loading…</p>}>
									{(parts) => (
										<For each={parts()}>
											{(p) =>
												p.added ? <ins>{p.value}</ins> : p.removed ? <del>{p.value}</del> : <span>{p.value}</span>
											}
										</For>
									)}
								</Show>
							</div>
						</Show>
					</aside>
				</Show>
			</div>
		</>
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
