import { Title } from "@solidjs/meta";
import { A, createAsync } from "@solidjs/router";
import { For, Show, createSignal, onMount } from "solid-js";
import Layout from "~/components/Layout"
import { toast } from "~/lib/toast";

const errT = (m: string) => toast(m, "error");
const okT = (m: string) => toast(m, "success");
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
	const [busyStage, setBusyStage] = createSignal("");
	const [pulling, setPulling] = createSignal(false);
	const [page, setPage] = createSignal(0);
	const PAGE = 25;
	const [tab, setTab] = createSignal<"import" | "enrich" | "schedule">("enrich");
	const [stageTab, setStageTab] = createSignal("");
	const [verdictMethod, setVerdictMethod] = createSignal("human");
	const [redoTarget, setRedoTarget] = createSignal<Result | null>(null);
	const [detailItem, setDetailItem] = createSignal<Item | null>(null);
	type Schedule = { enabled: boolean; discoverySource: string | null; discoveryIntervalDays: number; enrichPerDay: number; techPerDay: number; lastDiscoveryAt: string | null; lastEnrichAt: string | null } | null;
	const [schedule, setSchedule] = createSignal<Schedule>(null);

	async function loadSchedule() {
		const r = await fetch(`/api/funnels/runs/${props.params.id}/schedule`);
		if (r.ok) setSchedule(((await r.json()) as { schedule: Schedule }).schedule);
	}

	async function saveSchedule(e: Event) {
		e.preventDefault();
		const fd = new FormData(e.target as HTMLFormElement);
		const body = await post(`/api/funnels/runs/${props.params.id}/schedule`, {
			enabled: fd.get("enabled") === "on",
			discoverySource: String(fd.get("discoverySource") || "") || null,
			discoveryIntervalDays: Number(fd.get("discoveryIntervalDays") || 7),
			enrichPerDay: Number(fd.get("enrichPerDay") || 50),
			techPerDay: Number(fd.get("techPerDay") || 15),
		});
		if (body.error) return errT(body.error);
		okT("Schedule saved");
		await loadSchedule();
	}
	const [headFilter, setHeadFilter] = createSignal<{ stage: string; mode: "filled" | "awaiting" } | null>(null);
	const cycleHeadFilter = (stage: string) => {
		setPage(0);
		const cur = headFilter();
		if (!cur || cur.stage !== stage) return setHeadFilter({ stage, mode: "filled" });
		if (cur.mode === "filled") return setHeadFilter({ stage, mode: "awaiting" });
		setHeadFilter(null);
	};
	const filtered = () =>
		items().filter((it) => {
			const f = headFilter();
			if (!f) return true;
			const has = resultFor(it.id, f.stage) !== undefined;
			return f.mode === "filled" ? has : !has;
		});
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
		if (body.error) return errT(body.error);
		setEditing(false);
		await refresh();
	}
	const activeStage = () => stages().find((s) => s.key === stageTab()) ?? stages().find((s) => queueFor(s.key).length > 0) ?? stages()[0];
	const itemById = () => new Map(items().map((i) => [i.id, i]));
	const pageCount = () => Math.max(1, Math.ceil(filtered().length / PAGE));
	const paged = () => {
		const p = Math.min(page(), pageCount() - 1);
		return filtered().slice(p * PAGE, p * PAGE + PAGE);
	};

	async function refresh() {
		const r = await fetch(`/api/funnels/runs/${props.params.id}`);
		if (!r.ok) return errT((await r.json().catch(() => ({})) as { error?: string }).error ?? "Load failed");
		const body = (await r.json()) as { run: Run; stages: Stage[]; items: Item[]; results: Result[]; summary: Summary };
		setRun(body.run);
		setStages(body.stages);
		setItems(body.items);
		setResults(body.results);
		setSummary(body.summary);
	}
	onMount(() => {
		void refresh();
		void loadSchedule();
	});

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
		;
		;
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
		if (body.error) return errT(body.error);
		okT(`Imported ${body.imported ?? 0}, ${body.duplicated ?? 0} duplicates, ${body.skippedPromoted ?? 0} already in Outreach`);
		(e.target as HTMLFormElement).reset();
		await refresh();
	}

	async function pullFmcsa(e: Event) {
		e.preventDefault();
		;
		;
		setPulling(true);
		try {
			const fd = new FormData(e.target as HTMLFormElement);
			const body = await post(`/api/funnels/runs/${props.params.id}/pull-fmcsa`, { limit: Number(fd.get("limit") || 200) });
			if (body.error) return errT(body.error);
			okT(`FMCSA: fetched ${body.fetched ?? 0}, imported ${body.imported ?? 0}, ${body.duplicated ?? 0} duplicates, ${body.skippedPromoted ?? 0} already in Outreach`);
			await refresh();
		} finally {
			setPulling(false);
		}
	}

	async function record(e: SubmitEvent, stage: string, itemId: string, method: string) {
		e.preventDefault();
		;
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
		if (body.error) return errT(body.error);
		form.reset();
		await refresh();
	}

	async function redo(resultId: string) {
		;
		const body = await post(`/api/funnels/results/${resultId}/redo`, {});
		if (body.error) return errT(body.error);
		await refresh();
	}

	async function runStage(stage: string) {
		setBusyStage(stage);
		;
		const limitInput = document.getElementById(`${stage}-limit`) as HTMLInputElement | null;
		const body = await post(`/api/funnels/runs/${props.params.id}/run-stage`, { stage, limit: Number(limitInput?.value || 50) });
		setBusyStage("");
		if (body.error) return errT(body.error);
		okT(`${stage}: ${body.results ?? 0} verdicts recorded, ${body.errors ?? 0} errors${body.firstError ? ` — first error: ${body.firstError}` : ""}`);
		await refresh();
	}

	async function closeRun() {
		const body = await post(`/api/funnels/runs/${props.params.id}`, { action: "close" });
		if (body.error) return errT(body.error);
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
					<button type="button" class={`btn btn-sm ${tab() === "schedule" ? "btn-primary" : ""}`} onClick={() => setTab("schedule")}>Schedule</button>
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
							top <input name="limit" type="number" class="num" min="1" max="1600" value="200" /> newest Indiana brokers/3PLs
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
							<For each={stages()}>
								{(s) => (
									<th title={`${s.gate} — click to filter: filled → awaiting → all`}>
										<a
											href="#"
											onClick={(e) => { e.preventDefault(); cycleHeadFilter(s.key); }}
											style={{
												color: headFilter()?.stage === s.key ? "var(--accent, #000)" : "inherit",
												"text-decoration": headFilter()?.stage === s.key ? "underline" : "none",
												"font-weight": headFilter()?.stage === s.key ? 600 : 400,
											}}
										>
											{s.label}
											<Show when={headFilter()?.stage === s.key}>{headFilter()?.mode === "filled" ? " ▾" : " ▴"}</Show>
										</a>
									</th>
								)}
							</For>
							<th></th>
						</tr>
					</thead>
					<tbody>
						<For each={paged()}>
							{(it) => (
								<tr>
									<td>
										<a href={it.sourceUrl ?? "#"} target={it.sourceUrl ? "_blank" : undefined} rel="noreferrer" title="Open company detail" onClick={(e) => { if (!it.sourceUrl) e.preventDefault(); setDetailItem(it); }}>{it.companyName}</a>
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
				<div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "16px" }}>
					<button type="button" class="btn btn-sm" disabled={page() === 0} onClick={() => setPage(page() - 1)} title="Previous page">←</button>
					<span class="muted" style={{ "font-size": "13px" }}>
						{paged().length} on this page · {filtered().length}{headFilter() ? `/${items().length}` : ""} total · {pageCount() - 1 - Math.min(page(), pageCount() - 1)} pages left
					</span>
					<button type="button" class="btn btn-sm" disabled={page() >= pageCount() - 1} onClick={() => setPage(page() + 1)} title="Next page">→</button>
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
										{busyStage() === s().key ? "Running…" : `Run stage (${s().key === "tech_team" ? "Apollo" : "Prospeo"})`}
									</button>{" "}
									<label class="muted" style={{ "font-size": "12px" }}>
										<input id={`${s().key}-limit`} type="number" class="num" min="1" max="500" value="50" /> per click
									</label>{" "}
								</Show>
							</div>
						</div>
					)}
				</Show>
			</Show>

		<Show when={tab() === "schedule"}>
			<div class="card" style={{ "margin-bottom": "16px" }}>
				<h2 style={{ "font-size": "15px", margin: "0 0 8px" }}>Schedule</h2>
				<p class="muted" style={{ "font-size": "13px", margin: "0 0 12px" }}>
					Runs itself on the server scheduler (no agent needed): discovery pulls new companies, enrichment advances the gates once a day.
					{" "}Last discovery: {schedule()?.lastDiscoveryAt ? new Date(schedule()!.lastDiscoveryAt!).toLocaleString() : "never"}
					{" · "}last enrichment: {schedule()?.lastEnrichAt ? new Date(schedule()!.lastEnrichAt!).toLocaleString() : "never"}.
				</p>
				<form onSubmit={saveSchedule}>
					<div class="form-row" style={{ "flex-wrap": "wrap", gap: "10px" }}>
						<label class="muted" style={{ "font-size": "13px" }}>
							<input type="checkbox" name="enabled" checked={schedule()?.enabled ?? false} /> enabled
						</label>
						<label class="muted" style={{ "font-size": "13px" }}>
							discovery
							<select name="discoverySource">
								<option value="" selected={!schedule()?.discoverySource}>none</option>
								<option value="fmcsa" selected={schedule()?.discoverySource === "fmcsa"}>FMCSA census (new Indiana brokers)</option>
							</select>
						</label>
						<label class="muted" style={{ "font-size": "13px" }}>
							every <input name="discoveryIntervalDays" type="number" class="num" min="1" value={schedule()?.discoveryIntervalDays ?? 7} /> days
						</label>
						<label class="muted" style={{ "font-size": "13px" }}>
							<input name="enrichPerDay" type="number" class="num" min="1" value={schedule()?.enrichPerDay ?? 50} /> enrich/day (Prospeo)
						</label>
						<label class="muted" style={{ "font-size": "13px" }}>
							<input name="techPerDay" type="number" class="num" min="1" value={schedule()?.techPerDay ?? 15} /> tech-team/day (Apollo)
						</label>
						<button type="submit" class="btn btn-sm btn-primary">Save schedule</button>
					</div>
				</form>
			</div>
		</Show>

		<Show when={detailItem()}>
			{(it) => (
				<div
					style={{ position: "fixed", inset: "0", background: "rgba(0,0,0,0.4)", display: "flex", "align-items": "center", "justify-content": "center", "z-index": "100" }}
					onClick={(e) => e.target === e.currentTarget && setDetailItem(null)}
				>
					<div class="card" style={{ width: "560px", "max-width": "92vw", "max-height": "86vh", overflow: "auto", margin: "0" }}>
						<h3 style={{ "font-size": "15px", margin: "0 0 4px" }}>
							{it().companyName}
							<Show when={it().promotedAt}> ★</Show>
						</h3>
						<p class="muted" style={{ margin: "0 0 12px", "font-size": "13px" }}>
							{[it().city, it().state].filter(Boolean).join(", ")} · {it().sourceKind ?? "manual"}
							<Show when={it().sourceUrl}>{" · "}<a href={it().sourceUrl!} target="_blank" rel="noreferrer">source</a></Show>
						</p>
						<For each={stages()}>
							{(s) => {
								const r = () => resultFor(it().id, s.key);
								return (
									<div style={{ "border-top": "1px solid var(--border, #eee)", padding: "10px 0" }}>
										<strong style={{ "font-size": "13px" }}>{s.label}</strong>{" "}
										<span class="muted" style={{ "font-size": "12px" }}>{s.gate}</span>
										<Show
											when={r()}
											fallback={
												<Show when={run()?.status === "open"} fallback={<span class="muted" style={{ "font-size": "13px" }}> – awaiting</span>}>
													<form class="form-row" onSubmit={(e) => record(e, s.key, it().id, verdictMethod())} style={{ "margin-top": "6px" }}>
														<input name="note" placeholder={`note (${s.label.toLowerCase()} value/evidence)`} style={{ "max-width": "240px" }} />
														<input name="evidenceUrl" placeholder="evidence URL" style={{ "max-width": "200px" }} />
														<button type="submit" class="btn btn-sm btn-primary" name="verdict" value="pass">✓ pass</button>
														<button type="submit" class="btn btn-sm" name="verdict" value="fail">✗ fail</button>
													</form>
												</Show>
											}
										>
											{(res) => (
												<div class="form-row" style={{ "font-size": "13px", "align-items": "center", "margin-top": "4px" }}>
													<span>{res().verdict === "pass" ? "✓" : "✗"}</span>
													<span class="muted">{res().note ?? ""}</span>
													<span class="badge">{res().method}</span>
													<Show when={res().evidenceUrl}>
														<a href={res().evidenceUrl!} target="_blank" rel="noreferrer">evidence</a>
													</Show>
													<span class="muted">{res().checkedAt.slice(0, 10)}</span>
													<button type="button" class="delete-btn" title="Redo — clears this stage verdict" onClick={() => { setDetailItem(null); setRedoTarget(res()); }}>✕</button>
												</div>
											)}
										</Show>
									</div>
								);
							}}
						</For>
						<div class="form-row" style={{ "margin-top": "12px" }}>
							<label class="muted" style={{ "font-size": "12px" }}>
								manual verdicts record as
								<select value={verdictMethod()} onChange={(e) => setVerdictMethod((e.target as HTMLSelectElement).value)}>
									<option value="human">human</option>
									<option value="agent">agent</option>
								</select>
							</label>
							<button type="button" class="btn btn-sm" onClick={() => setDetailItem(null)}>Close</button>
						</div>
					</div>
				</div>
			)}
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
