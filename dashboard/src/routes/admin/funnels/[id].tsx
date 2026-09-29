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
	return (await r.json().catch(() => ({}))) as { error?: string; ok?: boolean; results?: number; errors?: number; fetched?: number; imported?: number; duplicated?: number; skippedPromoted?: number };
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

	async function pullYeti(e: Event) {
		e.preventDefault();
		setError("");
		setMsg("");
		setPulling(true);
		try {
			const fd = new FormData(e.target as HTMLFormElement);
			const body = await post(`/api/funnels/runs/${props.params.id}/pull-yeti`, { limit: Number(fd.get("limit") || 50) });
			if (body.error) return setError(body.error);
			setMsg(`ImportYeti: fetched ${body.fetched ?? 0}, imported ${body.imported ?? 0}, ${body.duplicated ?? 0} duplicates, ${body.skippedPromoted ?? 0} already in Outreach`);
			await refresh();
		} finally {
			setPulling(false);
		}
	}

	async function record(e: Event, stage: string) {
		e.preventDefault();
		setError("");
		const form = e.target as HTMLFormElement;
		const fd = new FormData(form);
		const body = await post("/api/funnels/results", {
			itemId: String(fd.get("itemId")),
			stage,
			verdict: String(fd.get("verdict")),
			evidenceUrl: String(fd.get("evidenceUrl") ?? ""),
			note: String(fd.get("note") ?? ""),
			method: String(fd.get("method") || "human"),
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
		const body = await post(`/api/funnels/runs/${props.params.id}/run-stage`, { stage });
		setBusyStage("");
		if (body.error) return setError(body.error);
		setMsg(`${stage}: ${body.results ?? 0} verdicts recorded, ${body.errors ?? 0} errors`);
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
			<h1 class="page-title">
				{run()?.note || "Funnel run"}
				<Show when={run()}>
					<span class="muted" style={{ "font-size": "14px", "font-weight": "normal" }}> · {run()!.source} · {run()!.status}</span>
				</Show>
			</h1>
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

			<Show when={run()?.status === "open"}>
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
					<form onSubmit={pullYeti} style={{ "margin-top": "12px", "border-top": "1px solid var(--border, #ddd)", "padding-top": "12px" }}>
						<button type="submit" class="btn" disabled={pulling()}>Pull from ImportYeti</button>{" "}
					<label class="muted" style={{ "font-size": "12px" }}>
							top <input name="limit" type="number" min="1" max="200" value="50" style={{ width: "60px" }} /> by shipments
						</label>
					<Show when={pulling()}>
							<span class="muted" style={{ "font-size": "12px" }}> pulling… ~4s per search page, keep this tab open</span>
						</Show>
					</form>
				</div>
			</Show>

			<table class="table" style={{ "margin-bottom": "16px" }}>
				<thead>
					<tr>
						<th>Company</th>
						<For each={stages()}>{(s) => <th title={s.gate}>{s.label}</th>}</For>
						<th></th>
					</tr>
				</thead>
				<tbody>
					<For each={items()}>
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
												<Show
													when={r()}
													fallback={<span class="muted">–</span>}
												>
													{(res) => (
														<>
															<Show when={res().verdict === "pass"} fallback={<span title={res().note ?? "failed"}>✗</span>}>
																<Show when={res().evidenceUrl} fallback={<span>✓</span>}>
																	<a href={res().evidenceUrl!} target="_blank" rel="noreferrer" title={res().note ?? ""}>✓</a>
																</Show>
															</Show>{" "}
															<button type="button" class="delete-btn" title="Redo — clears this stage and re-queues the item" onClick={() => redo(res().id)}>↺</button>
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

			<h2 style={{ "font-size": "15px", margin: "0 0 8px" }}>Stage queues</h2>
			<For each={stages()}>
				{(s) => {
					const queue = () => queueFor(s.key);
					return (
						<div class="card" style={{ "margin-bottom": "12px" }}>
							<h3 style={{ "font-size": "14px", margin: "0 0 4px" }}>
								{s.label} <span class="muted">({queue().length} awaiting · {s.gate})</span>
								<Show when={s.method === "api" && run()?.status === "open"}>
									{" "}
									<button type="button" class="btn btn-sm" disabled={busyStage() === s.key} onClick={() => runStage(s.key)}>
										{busyStage() === s.key ? "Running…" : "Run stage (Apollo)"}
									</button>
								</Show>
							</h3>
							<Show when={queue().length > 0 && run()?.status === "open"} fallback={<Show when={queue().length > 0}><p class="muted" style={{ margin: 0, "font-size": "13px" }}>{queue().map((i) => i.companyName).join(" · ")}</p></Show>}>
								<form class="form-row" onSubmit={(e) => record(e, s.key)}>
									<select name="itemId" required>
										<For each={queue()}>{(i) => <option value={i.id}>{i.companyName}</option>}</For>
									</select>
									<select name="verdict">
										<option value="pass">pass</option>
										<option value="fail">fail</option>
									</select>
									<select name="method">
										<option value="human">human</option>
										<option value="agent">agent</option>
										<option value="api">api</option>
										<option value="source">source</option>
									</select>
									<input name="evidenceUrl" placeholder="evidence URL" />
									<input name="note" placeholder="note" />
									<button type="submit" class="btn btn-primary btn-sm">Record</button>
								</form>
							</Show>
						</div>
					);
				}}
			</For>
		</Layout>
	);
}
