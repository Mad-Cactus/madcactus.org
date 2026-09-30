import { Title } from "@solidjs/meta";
import { A, createAsync } from "@solidjs/router";
import { For, Show, createSignal, onMount } from "solid-js";
import Layout from "~/components/Layout";
import { getUserQuery } from "~/lib/queries";

type Stage = { key: string; label: string; gate: string; method: string };
type Run = { id: string; funnelId: string; source: string; status: string; note: string | null; createdAt: string; closedAt: string | null };
type Item = { id: string; companyName: string; city: string | null; state: string | null; sourceUrl: string | null; sourceKind: string | null; prospectId: string | null; promotedAt: string | null };
type Result = { id: string; itemId: string; stage: string; verdict: "pass" | "fail"; evidenceUrl: string | null; note: string | null; method: string; checkedAt: string };
type Summary = { total: number; byStage: { stage: string; label: string; passed: number; failed: number; awaiting: number }[] };

const post = async (url: string, body: unknown) => {
	const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
	return (await r.json().catch(() => ({}))) as { error?: string; ok?: boolean; results?: number; errors?: number; firstError?: string; fetched?: number; imported?: number; duplicated?: number; skippedPromoted?: number };
};

// One funnel run: summary bar, item table with stage chips, per-stage queues.
// Redo clears a stage (re-queues the item); a fail on a promoted prospect
// un-approves it via the API.
export default function AdminFunnelRun(props: { params: { id: string } }) {
	createAsync(() => getUserQuery(), { deferStream: true });
	const [run, setRun] = createSignal<Run | null>(null);
	const [stages, setStages] = createSignal<Stage[]>([]);
	const [items, setItems] = createSignal<Item[]>([]);
	const [results, setResults] = createSignal<Result[]>([]);
	const [summary, setSummary] = createSignal<Summary | null>(null);
	const [msg, setMsg] = createSignal("");
	const [error, setError] = createSignal("");
	const [busyStage, setBusyStage] = createSignal("");
	const [pulling, setPulling] = createSignal(false);
	const [page, setPage] = createSignal(0);
	const PAGE = 25;
	const [tab, setTab] = createSignal<"import" | "enrich">("enrich");
	const [stageTab, setStageTab] = createSignal("");
	const [verdictMethod, setVerdictMethod] = createSignal("human");
	const [redoTarget, setRedoTarget] = createSignal<Result | null>(null);
	const confirmRedo = async () => {
		const r = redoTarget();
		setRedoTarget(null);
		if (r) await redo(r.id);
	};
	const [editing, setEditing] = createSignal(false);

	async function saveEdit(e: Event) {
		e.preventDefault();
		const fd = new FormData(e.target as HTMLFormElement);
		const body = await post(`/api/funnels/runs/${props.params.id}`, { action: "edit", note: String(fd.get("note") ?? ""), source: String(fd.get("source") ?? "") });
		if (body.error) return setError(body.error);
		setEditing(false);
		await refresh();
	}
	const activeStage = () => stages().find((s) => s.key === stageTab()) ?? stages().find((s) => queueFor(s.key).length > 0) ?? stages()[0];
	const itemById = () => new Map(items().map((i) => [i.id, i]));
	const pageCount = () => Math.max(1, Math.ceil(items().length / PAGE));
	const paged = () => {
		const p = Math.min(page(), pageCount() - 1);
		return items().slice(p * PAGE, p * PAGE + PAGE);
	};

	async function refresh() {
		const r = await fetch(`/api/funnels/runs/${props.params.id}`);
		if (!r.ok) return setError((await r.json().catch(() => ({})) as { error?: string }).error ?? "Load failed");
		const body = (await r.json()) as { run: Run; stages: Stage[]; items: Item[]; results: Result[]; summary: Summary };
		setRun(body.run);
		setStages(body.stages);
		setItems(body.items);
		setResults(body.results);
		setSummary(body.summary);
	}
	onMount(() => void refresh());

	const resultFor = (itemId: string, stage: string) => results().find((r) => r.itemId === itemId && r.stage === stage);
	const queueFor = (stage: string) =>
		items().filter((it) => {
			const at = stages().findIndex((s) => s.key === stage);
			return stages().every((s, i) => {
				if (i > at) return true;
				const r = resultFor(it.id, s.key);
				return i < at ? r?.verdict === "pass" : !r;
			});
		});

	async function import_(e: Event) {
		e.preventDefault();
		setError("");
		setMsg("");
		const fd = new FormData(e.target as HTMLFormElement);
		const sourceKind = String(fd.get("sourceKind") || "paste");
		const rows = String(fd.get("payload") ?? "")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const parts = line.includes("\t") ? line.split("\t") : line.split(",").map((p) => p.trim());
				const [company, city, state, sourceUrl] = parts.map((p) => p.replace(/^"|"$/g, "").trim());
				return {
					companyName: company,
					city: city || null,
					state: state || null,
					sourceUrl: sourceUrl || null,
					sourceKind,
					rawData: { pastedLine: line },
				};
			});
		const body = (await (await fetch(`/api/funnels/runs/${props.params.id}/items`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ items: rows }),
		})).json()) as { error?: string; imported?: number; duplicated?: number; skippedPromoted?: number };
		if (body.error) return setError(body.error);
		setMsg(`Imported ${body.imported ?? 0}, ${body.duplicated ?? 0} duplicates, ${body.skippedPromoted ?? 0} already in Outreach`);
		(e.target as HTMLFormElement).reset();
		await refresh();
	}

	async function pullFmcsa(e: Event) {
		e.preventDefault();
		setError("");
		setMsg("");
		setPulling(true);
		try {
			const fd = new FormData(e.target as HTMLFormElement);
			const body = await post(`/api/funnels/runs/${props.params.id}/pull-fmcsa`, { limit: Number(fd.get("limit") || 200) });
			if (body.error) return setError(body.error);
			setMsg(`FMCSA: fetched ${body.fetched ?? 0}, imported ${body.imported ?? 0}, ${body.duplicated ?? 0} duplicates, ${body.skippedPromoted ?? 0} already in Outreach`);
			await refresh();
		} finally {
			setPulling(false);
		}
	}

	async function record(e: SubmitEvent, stage: string, itemId: string, method: string) {
		e.preventDefault();
		setError("");
		const form = e.target as HTMLFormElement;
		const fd = new FormData(form);
		const body = await post("/api/funnels/results", {
			itemId,
			stage,
			verdict: String(fd.get("verdict") ?? ""),
			evidenceUrl: String(fd.get("evidenceUrl") ?? ""),
			note: String(fd.get("note") ?? ""),
			method,
		});
		if (body.error) return setError(body.error);
		form.reset();
		await refresh();
	}

	async function redo(resultId: string) {
		setError("");
		const body = await post(`/api/funnels/results/${resultId}/redo`, {});
		if (body.error) return setError(body.error);
		await refresh();
	}

	async function runStage(stage: string) {
		setBusyStage(stage);
		setError("");
		const limitInput = document.getElementById(`${stage}-limit`) as HTMLInputElement | null;
		const body = await post(`/api/funnels/runs/${props.params.id}/run-stage`, { stage, limit: Number(limitInput?.value || 50) });
		setBusyStage("");
		if (body.error) return setError(body.error);
		setMsg(`${stage}: ${body.results ?? 0} verdicts recorded, ${body.errors ?? 0} errors${body.firstError ? ` — first error: ${body.firstError}` : ""}`);
		await refresh();
	}

	async function closeRun() {
		const body = await post(`/api/funnels/runs/${props.params.id}`, { action: "close" });
		if (body.error) return setError(body.error);
		await refresh();
	}

	return (
		<Layout>
			<Title>Funnel run</Title>
			<p class="muted" style={{ margin: "0" }}><A href="/admin/funnels">← Funnels</A></p>
			<Show when={!editing()} fallback={
				<form class="form-row" onSubmit={saveEdit} style={{ "margin-bottom": "8px" }}>
					<input name="note" value={run()?.note ?? ""} placeholder="run title" style={{ "max-width": "320px" }} />
					<input name="source" value={run()?.source ?? ""} placeholder="source" style={{ "max-width": "160px" }} />
					<button type="submit" class="btn btn-sm btn-primary">Save</button>
					<button type="button" class="btn btn-sm" onClick={() => setEditing(false)}>Cancel</button>
				</form>
			}>
				<h1 class="page-title">
					{run()?.note || "Funnel run"}
					<Show when={run()}>
						<span class="muted" style={{ "font-size": "14px", "font-weight": "normal" }}> · {run()!.source} · {run()!.status}</span>{" "}
						<button type="button" class="btn btn-sm" title="Edit title and source" onClick={() => setEditing(true)}>Edit</button>
					</Show>
				</h1>
			</Show>
			<Show when={error()}><p class="login-error">{error()}</p></Show>
			<Show when={msg()}><p class="muted">{msg()}</p></Show>

			<Show when={summary()}>
				<div style={{ display: "flex", "flex-wrap": "wrap", gap: "6px", "margin-bottom": "16px" }}>
					<For each={summary()!.byStage}>
						{(s) => (
							<span class="badge" title={s.stage}>
								{s.label}: <strong>{s.passed}</strong>✓ <strong>{s.failed}</strong>✗ <span class="muted">{s.awaiting}–</span>
							</span>
						)}
					</For>
				</div>
			</Show>

			<Show when={run()}>
				<div class="form-row" style={{ "margin-bottom": "16px", gap: "8px" }}>
					<button type="button" class={`btn btn-sm ${tab() === "import" ? "btn-primary" : ""}`} onClick={() => setTab("import")}>Import</button>
					<button type="button" class={`btn btn-sm ${tab() === "enrich" ? "btn-primary" : ""}`} onClick={() => setTab("enrich")}>Enrichment</button>
				</div>
			</Show>

			<Show when={tab() === "import" && run()?.status === "open"}>
				<div class="card" style={{ "margin-bottom": "16px" }}>
					<h2 style={{ "font-size": "15px", margin: "0 0 8px" }}>Import companies</h2>
					<form onSubmit={import_}>
						<div class="form-row">
							<select name="sourceKind">
								<option value="paste">paste</option>
								<option value="importyeti">importyeti</option>
								<option value="fmcsa">fmcsa</option>
							</select>
						</div>
						<textarea
							name="payload"
							rows="4"
							placeholder={"One per line: Company, City, State, SourceUrl"}
							style={{ width: "100%", "margin-bottom": "8px" }}
						/>
						<button type="submit" class="btn btn-primary">Import</button>{" "}
						<button type="button" class="btn" onClick={closeRun}>Close run</button>
					</form>
					<form onSubmit={pullFmcsa} style={{ "margin-top": "12px", "border-top": "1px solid var(--border, #ddd)", "padding-top": "12px" }}>
						<button type="submit" class="btn" disabled={pulling()}>Pull from FMCSA</button>{" "}
						<label class="muted" style={{ "font-size": "12px" }}>
							top <input name="limit" type="number" min="1" max="1600" value="200" style={{ width: "60px" }} /> newest Indiana brokers/3PLs
						</label>
						<Show when={pulling()}>
							<span class="muted" style={{ "font-size": "12px" }}> pulling… one census query, then inserts</span>
						</Show>
					</form>
				</div>
			</Show>

			<Show when={tab() === "enrich"}>
				<table class="table" style={{ "margin-bottom": "16px" }}>
					<thead>
						<tr>
							<th>Company</th>
							<For each={stages()}>{(s) => <th title={s.gate}>{s.label}</th>}</For>
							<th></th>
						</tr>
					</thead>
					<tbody>
						<For each={paged()}>
							{(it) => (
								<tr>
									<td>
										<Show when={it.sourceUrl} fallback={it.companyName}>
											<a href={it.sourceUrl!} target="_blank" rel="noreferrer">{it.companyName}</a>
										</Show>
										<Show when={it.promotedAt}> ★</Show>
										<Show when={it.city || it.state}>
											<div class="muted" style={{ "font-size": "12px" }}>{[it.city, it.state].filter(Boolean).join(", ")}</div>
										</Show>
									</td>
									<For each={stages()}>
										{(s) => {
											const r = () => resultFor(it.id, s.key);
											return (
												<td>
													<Show when={r()} fallback={<span class="muted">–</span>}>
														{(res) => (
															<>
																<Show when={res().verdict === "pass"} fallback={<span class="muted" title={res().note ?? "failed"}>✗ {res().note ?? ""}</span>}>
																	<span title={res().note ?? ""} style={{ "font-size": "13px" }}>
																		✓ <Show when={res().evidenceUrl} fallback={<span>{res().note ?? ""}</span>}>
																			<a href={res().evidenceUrl!} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{res().note ?? ""}</a>
																		</Show>
																	</span>
																</Show>{" "}
																<button type="button" class="delete-btn" title="Redo — clears this stage verdict" onClick={() => setRedoTarget(res())}>✕</button>
															</>
														)}
													</Show>
												</td>
											);
										}}
									</For>
									<td>{it.promotedAt ? <span class="badge badge-active">in Outreach</span> : ""}</td>
								</tr>
							)}
						</For>
					</tbody>
				</table>
				<div class="form-row" style={{ "align-items": "center", "margin-bottom": "16px" }}>
					<button type="button" class="btn btn-sm" disabled={page() === 0} onClick={() => setPage(page() - 1)}>← Prev</button>
					<span class="muted" style={{ "font-size": "13px" }}>
						{Math.min(page() * PAGE + 1, items().length)}–{Math.min((page() + 1) * PAGE, items().length)} of {items().length}
					</span>
					<button type="button" class="btn btn-sm" disabled={page() >= pageCount() - 1} onClick={() => setPage(page() + 1)}>Next →</button>
				</div>

				<h2 style={{ "font-size": "15px", margin: "0 0 8px" }}>Stages</h2>
				<div class="form-row" style={{ "margin-bottom": "12px", gap: "6px", "flex-wrap": "wrap" }}>
					<For each={stages()}>
						{(s) => (
							<button
								type="button"
								class={`btn btn-sm ${activeStage()?.key === s.key ? "btn-primary" : ""}`}
								onClick={() => setStageTab(s.key)}
								title={s.gate}
							>
								{s.label} <span class="muted">({queueFor(s.key).length})</span>
							</button>
						)}
					</For>
				</div>

				<Show when={activeStage()}>
					{(s) => (
						<div class="card" style={{ "margin-bottom": "16px" }}>
							<h3 style={{ "font-size": "14px", margin: "0 0 8px" }}>
								{s().label} <span class="muted">· {s().gate} · {queueFor(s().key).length} awaiting</span>
							</h3>
							<div class="form-row" style={{ "margin-bottom": "12px" }}>
								<Show when={s().method === "api" && run()?.status === "open"}>
									<button type="button" class="btn btn-sm btn-primary" disabled={busyStage() === s().key} onClick={() => runStage(s().key)}>
										{busyStage() === s().key ? "Running…" : "Run stage"}
									</button>{" "}
									<label class="muted" style={{ "font-size": "12px" }}>
										<input id={`${s().key}-limit`} type="number" min="1" max="500" value="50" style={{ width: "54px" }} /> per click
									</label>{" "}
								</Show>
								<label class="muted" style={{ "font-size": "12px" }}>
									manual verdicts record as
									<select value={verdictMethod()} onChange={(e) => setVerdictMethod((e.target as HTMLSelectElement).value)}>
										<option value="human">human</option>
										<option value="agent">agent</option>
									</select>
								</label>
							</div>

							<h4 style={{ "font-size": "13px", margin: "0 0 6px" }}>Awaiting</h4>
							<Show
								when={queueFor(s().key).length > 0 && run()?.status === "open"}
								fallback={<p class="muted" style={{ margin: 0, "font-size": "13px" }}>{queueFor(s().key).length === 0 ? "Queue clear." : `${queueFor(s().key).length} awaiting — run closed.`}</p>}
							>
								<For each={queueFor(s().key).slice(0, 100)}>
									{(it) => (
										<form class="form-row" onSubmit={(e) => record(e, s().key, it.id, verdictMethod())}>
											<span style={{ "min-width": "230px", "font-size": "13px" }}>{it.companyName}</span>
											<input name="note" placeholder="note" style={{ "max-width": "220px" }} />
											<input name="evidenceUrl" placeholder="evidence URL" style={{ "max-width": "220px" }} />
											<button type="submit" class="btn btn-sm btn-primary" name="verdict" value="pass">✓ pass</button>
											<button type="submit" class="btn btn-sm" name="verdict" value="fail">✗ fail</button>
										</form>
									)}
								</For>
								<Show when={queueFor(s().key).length > 100}>
									<p class="muted" style={{ "font-size": "12px" }}>Showing first 100 of {queueFor(s().key).length} — run the stage batch or record via API for the rest.</p>
								</Show>
							</Show>

							<h4 style={{ "font-size": "13px", margin: "12px 0 6px" }}>Recorded — what happened at this stage</h4>
							<For each={results().filter((r) => r.stage === s().key).sort((a, b) => b.checkedAt.localeCompare(a.checkedAt)).slice(0, 100)}>
								{(r) => (
									<div class="form-row" style={{ "font-size": "13px", "align-items": "center" }}>
										<span style={{ "min-width": "230px" }}>{itemById().get(r.itemId)?.companyName ?? "—"}</span>
										<span>{r.verdict === "pass" ? "✓" : "✗"}</span>
										<span class="muted" style={{ "max-width": "320px", overflow: "hidden", "text-overflow": "ellipsis" }}>{r.note ?? ""}</span>
										<span class="badge">{r.method}</span>
										<Show when={r.evidenceUrl}>
											<a href={r.evidenceUrl!} target="_blank" rel="noreferrer">evidence</a>
										</Show>
										<span class="muted" title={r.checkedAt}>{r.checkedAt.slice(0, 10)}</span>
										<button type="button" class="delete-btn" title="Redo — clears this stage verdict" onClick={() => setRedoTarget(r)}>✕</button>
									</div>
								)}
							</For>
						</div>
					)}
				</Show>
			</Show>

			<Show when={redoTarget()}>
			{(r) => (
				<div
					style={{ position: "fixed", inset: "0", background: "rgba(0,0,0,0.4)", display: "flex", "align-items": "center", "justify-content": "center", "z-index": "100" }}
					onClick={(e) => e.target === e.currentTarget && setRedoTarget(null)}
				>
					<div class="card" style={{ width: "420px", "max-width": "90vw", margin: "0" }}>
						<h3 style={{ "font-size": "15px", margin: "0 0 8px" }}>Redo this stage verdict?</h3>
						<p style={{ margin: "0 0 16px", "font-size": "14px" }}>
							<strong>{itemById().get(r().itemId)?.companyName ?? "Company"}</strong> ·{" "}
							{stages().find((s) => s.key === r().stage)?.label ?? r().stage}
							<span class="muted" style={{ display: "block", "margin-top": "4px" }}>
								Current: {r().verdict === "pass" ? "✓" : "✗"} {r().note ?? ""}. Clearing re-queues the company at this stage and may un-promote it.
							</span>
						</p>
						<div class="form-row">
							<button type="button" class="btn btn-primary" onClick={confirmRedo}>Yes, clear it</button>
							<button type="button" class="btn" onClick={() => setRedoTarget(null)}>Cancel</button>
						</div>
					</div>
				</div>
			)}
		</Show>
		</Layout>
	);
}
