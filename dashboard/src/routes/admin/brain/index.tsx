import { Title } from "@solidjs/meta";
import { useAction, createAsync, revalidate } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import Layout from "~/components/Layout";
import {
	getBrainStatsQuery,
	getOpenLoopsQuery,
	getRecentFactsQuery,
	getBrainPagesQuery,
	runBrainCycleAction,
	closeLoopAction,
} from "~/lib/brain/admin";

const kindColor: Record<string, string> = {
	lesson: "var(--accent, #a855f7)",
	commitment: "#f59e0b",
	preference: "#10b981",
	event: "#3b82f6",
};

export default function AdminBrain() {
	const stats = createAsync(() => getBrainStatsQuery(), { deferStream: true });
	const loops = createAsync(() => getOpenLoopsQuery(), { deferStream: true });
	const facts = createAsync(() => getRecentFactsQuery(), { deferStream: true });
	const pages = createAsync(() => getBrainPagesQuery(), { deferStream: true });

	const runCycle = useAction(runBrainCycleAction);
	const closeLoop = useAction(closeLoopAction);
	const [busy, setBusy] = createSignal("");
	const [status, setStatus] = createSignal("");

	const refresh = async (label: string, reprocess = false) => {
		setBusy(label);
		setStatus("");
		const form = new FormData();
		if (reprocess) form.set("reprocessTranscripts", "true");
		const r = await runCycle(form);
		const c = (r as { cycle?: Record<string, { error?: string; inserted?: number; pairs?: number }> }).cycle;
		const errs = Object.entries(c ?? {})
			.filter(([, v]) => v?.error)
			.map(([k, v]) => `${k}: ${v!.error}`);
		setBusy("");
		setStatus(errs.length ? `ran — ${errs.join("; ")}` : "cycle complete");
		void revalidate("brain-stats");
		void revalidate("brain-facts");
		void revalidate("brain-loops");
		void revalidate("brain-pages");
	};

	const statCard = (label: string, value: () => number | string | undefined | null) => (
		<div class="card" style={{ padding: "14px 18px", flex: 1 }}>
			<div class="muted" style={{ "font-size": "12px" }}>{label}</div>
			<div style={{ "font-size": "22px", "font-weight": 600 }}>{value() ?? "—"}</div>
		</div>
	);

	return (
		<Layout>
			<Title>Brain — Mad Cactus</Title>
			<div style={{ display: "flex", "align-items": "baseline", gap: "16px" }}>
				<h1 class="page-title">Brain</h1>
				<div style={{ flex: 1 }} />
				<Show when={status()}>
					<span class="muted" style={{ "font-size": "13px" }}>{status()}</span>
				</Show>
				<button type="button" class="btn btn-sm" disabled={!!busy()} onClick={() => void refresh("slack")}>
					{busy() === "slack" ? "running…" : "Run cycle"}
				</button>
				<button type="button" class="btn btn-sm" disabled={!!busy()} onClick={() => void refresh("reprocess", true)}>
					{busy() === "reprocess" ? "running…" : "Reprocess transcripts"}
				</button>
			</div>
			<p class="page-subtitle">Distilled knowledge — pages, facts, conclusions, open loops</p>

			<Suspense fallback={<div class="muted">Loading…</div>}>
				<div style={{ display: "flex", gap: "12px", "margin-bottom": "20px" }}>
					{statCard("Pages", () => stats()?.pages)}
					{statCard("Facts", () => stats()?.facts)}
					{statCard("Takes", () => stats()?.takes)}
					{statCard("Open loops", () => stats()?.openLoops)}
					{statCard("Last cycle", () => {
						const at = stats()?.lastCycleAt;
						return at ? new Date(at).toLocaleString() : "never";
					})}
				</div>

				<div class="card" style={{ padding: "14px 18px", "margin-bottom": "16px" }}>
					<strong style={{ "font-size": "13px" }}>Open loops</strong>
					<Show when={loops()?.length} fallback={<div class="muted" style={{ "font-size": "13px", "margin-top": "6px" }}>Nothing waiting.</div>}>
						<For each={loops()}>
							{(l) => (
								<div style={{ display: "flex", gap: "10px", "align-items": "baseline", "margin-top": "8px", "font-size": "13px" }}>
									<span style={{ width: "170px", color: "var(--muted)" }}>{l.loopType}</span>
									<span style={{ flex: 1 }}>{l.summary}</span>
									<Show when={l.dueAt}>
										<span class="muted">due {new Date(l.dueAt!).toLocaleDateString()}</span>
									</Show>
									<form onSubmit={(e) => {
										e.preventDefault();
										const fd = new FormData(e.currentTarget);
										void closeLoop(fd).then(() => {
											void revalidate("brain-loops");
											void revalidate("brain-stats");
										});
									}}>
										<input type="hidden" name="loopId" value={l.id} />
										<button type="submit" class="btn btn-sm">close</button>
									</form>
								</div>
							)}
						</For>
					</Show>
				</div>

				<div style={{ display: "flex", gap: "16px", "align-items": "flex-start" }}>
					<div class="card" style={{ padding: "14px 18px", flex: 1, "min-width": "0" }}>
						<strong style={{ "font-size": "13px" }}>Recent facts</strong>
						<For each={facts()}>
							{(f) => (
								<div style={{ "margin-top": "8px", "font-size": "13px" }}>
									<span style={{ color: kindColor[f.kind] ?? "var(--muted)" }}>{f.kind}</span>
									{" "}
									<span class="muted" style={{ "font-size": "11px" }}>
										{f.entitySlug}{f.surface ? ` · ${f.surface}` : ""} · {f.sourceTable}
									</span>
									<div>{f.fact}</div>
								</div>
							)}
						</For>
						<Show when={!facts()?.length}>
							<div class="muted" style={{ "font-size": "13px", "margin-top": "6px" }}>
								No facts yet — set OPENROUTER_API_KEY and run a cycle.
							</div>
						</Show>
					</div>

					<div class="card" style={{ padding: "14px 18px", flex: 1, "min-width": "0" }}>
						<strong style={{ "font-size": "13px" }}>Pages (by salience)</strong>
						<For each={pages()}>
							{(p) => (
								<div style={{ display: "flex", gap: "8px", "margin-top": "8px", "font-size": "13px", "align-items": "baseline" }}>
									<span style={{ flex: 1 }}>
										{p.title} <span class="muted" style={{ "font-size": "11px" }}>{p.entityKind ?? p.type}</span>
									</span>
									<span class="muted" style={{ "font-size": "11px" }}>salience {p.weight.toFixed(2)}</span>
								</div>
							)}
						</For>
					</div>
				</div>
			</Suspense>
		</Layout>
	);
}
