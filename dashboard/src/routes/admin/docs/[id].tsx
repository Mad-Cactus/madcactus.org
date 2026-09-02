import { Title } from "@solidjs/meta";
import { useParams, createAsync } from "@solidjs/router";
import { Show, createSignal, onMount } from "solid-js";
import Layout from "~/components/Layout";
import LexicalDocEditor from "~/components/LexicalDocEditor";
import { getDocQuery } from "~/lib/docs-queries";

export default function AdminDocEditor() {
	const params = useParams();
	const doc = createAsync(() => getDocQuery(params.id ?? ""), { deferStream: true });
	const [markdown, setMarkdown] = createSignal("");
	const [status, setStatus] = createSignal("");
	const [shareUrl, setShareUrl] = createSignal("");

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

	const save = async (md: string) => {
		setStatus("saving…");
		const res = await fetch(`/api/docs/${params.id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ markdown: md }),
		});
		setStatus(res.ok ? `saved ${new Date().toLocaleTimeString()}` : "save failed");
	};

	const post = async (op: string, body: Record<string, unknown> = {}) => {
		const res = await fetch(`/api/docs/${params.id}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ op, ...body }),
		});
		return res.json();
	};

	return (
		<Layout>
			<Title>{doc()?.title ?? "Doc"} — Mad Cactus</Title>
			<Show when={doc()}>
				<div style={{ display: "flex", "align-items": "baseline", gap: "16px" }}>
					<h1 class="page-title">{doc()!.title}</h1>
					<span class="muted" style={{ "font-size": "13px" }}>{status() || `v${doc()!.version}`}</span>
					<div style={{ flex: 1 }} />
					<button type="button" class="btn btn-sm" onClick={async () => {
						const r = await post("share", { enabled: !shareUrl() });
						setShareUrl(r.shareToken ? `${location.origin}/share/${r.shareToken}` : "");
					}}>
						{shareUrl() ? "Unshare" : "Share"}
					</button>
					<button type="button" class="btn btn-sm" onClick={() => {
						const blob = new Blob([markdown()], { type: "text/markdown" });
						const a = document.createElement("a");
						a.href = URL.createObjectURL(blob);
						a.download = `${doc()!.title.replace(/[^\w-]+/g, "-")}.md`;
						a.click();
						URL.revokeObjectURL(a.href);
					}}>
						Export .md
					</button>
					<button type="button" class="btn btn-primary btn-sm" onClick={async () => {
						await save(markdown());
						const r = await post("finalize");
						setStatus(r.pairId ? `finalized → pair ${r.pairId.slice(0, 8)}` : r.error);
					}}>
						Finalize
					</button>
				</div>
				<Show when={shareUrl()}>
					<p class="muted" style={{ "font-size": "13px" }}>
						Public: <a href={shareUrl()}>{shareUrl()}</a>
					</p>
				</Show>
				<LexicalDocEditor
					markdown={markdown()}
					onMarkdownChange={setMarkdown}
					onSave={(md) => save(md)}
				/>
			</Show>
		</Layout>
	);
}
