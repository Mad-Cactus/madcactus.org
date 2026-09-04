import { Title } from "@solidjs/meta";
import { createAsync, useAction } from "@solidjs/router";
import { For, Show, Suspense, createSignal, createMemo } from "solid-js";
import Layout from "~/components/Layout";
import { getUserQuery } from "~/lib/queries";
import {
	getOutreachQuery,
	createOutreachAction,
	setOutreachStageAction,
	setOutreachNextActionAction,
	getBrainDigestQuery,
	type BrainDigestItem,
} from "~/lib/admin-queries";
import { OUTREACH_STAGES, type OutreachProspect, type OutreachStage } from "~/db/schema";

const STAGE_COLOR: Record<string, string> = {
	sent: "var(--text-subtle)",
	watching: "var(--orange)",
	replied: "#2980b9",
	meeting: "#2980b9",
	won: "var(--green)",
	shutdown: "var(--red)",
};

function fmtDate(d: Date | null): string {
	if (!d) return "—";
	return new Date(d).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

/** 272 → "4m 32s" */
function fmtDur(secs: number | null): string {
	if (!secs) return "";
	const m = Math.floor(secs / 60);
	const s = secs % 60;
	return m ? `${m}m ${s}s` : `${s}s`;
}

/** "viewed 2x · 78% · 3m 41s played · last …" — null while unopened. */
function videoSummary(p: OutreachProspect): string | null {
	if (p.videoViewCount === 0) return null;
	const parts = [`viewed ${p.videoViewCount}x`];
	if (p.videoCompleted) parts.push("finished");
	else if (p.videoDurationSeconds) {
		const pct = Math.min(100, Math.round((p.videoMaxPosition / p.videoDurationSeconds) * 100));
		if (pct > 0) parts.push(`${pct}%`);
	}
	if (p.videoWatchSeconds > 0) parts.push(`${fmtDur(p.videoWatchSeconds)} played`);
	parts.push(`last ${fmtDate(p.videoLastViewedAt)}`);
	return parts.join(" · ");
}

/** datetime-local value for an existing date (local wall clock). */
function toInputValue(d: Date | null): string {
	if (!d) return "";
	const p = (n: number) => String(n).padStart(2, "0");
	const x = new Date(d);
	return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
}

/** datetime-local submits wall clock; pin it to an instant (ISO+Z) in the
 * browser's tz so the server (which may run UTC) stores what was meant. */
function withInstantIso(fd: FormData): FormData {
	const v = String(fd.get("next_action_at") || "");
	fd.set("next_action_at", v ? new Date(v).toISOString() : "");
	return fd;
}

/** Due first, then by next action (no date sinks to bottom), then newest. */
function sortCards(a: OutreachProspect, b: OutreachProspect, dueIds: Set<string>): number {
	const d = Number(dueIds.has(b.id)) - Number(dueIds.has(a.id));
	if (d) return d;
	const an = a.nextActionAt?.getTime() ?? Infinity;
	const bn = b.nextActionAt?.getTime() ?? Infinity;
	if (an !== bn) return an - bn;
	return b.createdAt.getTime() - a.createdAt.getTime();
}

function DigestSection(props: { brainUrl: string }) {
	const digest = createAsync(() => getBrainDigestQuery(props.brainUrl), {
		deferStream: true,
	});
	return (
		<Suspense fallback={<p class="muted" style={{ "font-size": "12px" }}>Loading digest…</p>}>
			<Show when={digest()} fallback={<p class="muted" style={{ "font-size": "12px" }}>No digest available.</p>}>
				{(d) => (
					<Show
						when={!d().error}
						fallback={<p class="muted" style={{ "font-size": "12px", "font-style": "italic" }}>brain unreachable</p>}
					>
						<div style={{ "font-size": "12px" }}>
							<div class="muted" style={{ "margin-bottom": "4px" }}>What to mention:</div>
							<ul style={{ margin: "0", "padding-left": "18px" }}>
								<For each={(d() as { items: BrainDigestItem[] }).items}>
									{(item) => (
										<li style={{ "margin-bottom": "3px" }}>
											<span class="badge" style={{ color: "var(--text-subtle)", "margin-right": "6px" }}>{item.kind}</span>
											<Show when={item.citationUrl} fallback={<span>{item.headline}</span>}>
												<a href={item.citationUrl} target="_blank" rel="noreferrer">{item.headline}</a>
											</Show>
											<Show when={item.occurredOn}>
												<span class="muted"> · {item.occurredOn}</span>
											</Show>
										</li>
									)}
								</For>
							</ul>
						</div>
					</Show>
				)}
			</Show>
		</Suspense>
	);
}

function BoardCard(props: { prospect: OutreachProspect; due: boolean }) {
	const p = () => props.prospect;
	const setStage = useAction(setOutreachStageAction);
	const setNextAction = useAction(setOutreachNextActionAction);
	const [editing, setEditing] = createSignal(false);
	const [error, setError] = createSignal("");
	const [dragging, setDragging] = createSignal(false);

	function startDrag(e: DragEvent) {
		e.dataTransfer?.setData("text/plain", p().id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
		setDragging(true);
	}

	async function handleSave(e: Event) {
		e.preventDefault();
		setError("");
		const fd = new FormData(e.target as HTMLFormElement);
		const stage = String(fd.get("stage"));
		if (stage !== p().stage) {
			const sfd = new FormData();
			sfd.set("id", p().id);
			sfd.set("stage", stage);
			const r = (await setStage(sfd)) as { error?: string };
			if (r.error) {
				setError(r.error);
				return;
			}
		}
		const res = (await setNextAction(withInstantIso(fd))) as { error?: string };
		if (res.error) {
			setError(res.error);
			return;
		}
		setEditing(false);
	}

	return (
		<div
			class="board-card"
			classList={{ dragging: dragging() }}
			draggable
			onDragStart={startDrag}
			onDragEnd={() => setDragging(false)}
		>
			<div style={{ display: "flex", "align-items": "baseline", gap: "6px" }}>
				<span style={{ "font-weight": "600", "font-size": "13px" }}>{p().company}</span>
				<Show when={props.due}>
					<span class="badge" style={{ color: "var(--orange)", "margin-left": "auto", "white-space": "nowrap" }}>due</span>
				</Show>
			</div>
			<Show when={p().contactName || p().email}>
				<div class="muted" style={{ "font-size": "12px" }}>
					<Show when={p().contactName}>{p().contactName}</Show>
					<Show when={p().contactName && p().email}> · </Show>
					<Show when={p().email}>
						<a href={`mailto:${p().email}`} class="muted">{p().email}</a>
					</Show>
				</div>
			</Show>

			<div class="muted" style={{ "font-size": "12px", margin: "5px 0", color: props.due ? "var(--orange)" : undefined }}>
				→ {fmtDate(p().nextActionAt)}
				<Show when={p().nextActionNote}> — {p().nextActionNote}</Show>
			</div>

			<Show when={p().videoUrl || p().brainUrl}>
				<div style={{ "font-size": "12px", margin: "5px 0" }}>
					<Show when={p().videoUrl}>
						<a href={p().videoUrl!} target="_blank" rel="noreferrer">video ↗</a>{" "}
						<button
							type="button"
							class="btn btn-sm"
							onClick={() => navigator.clipboard.writeText(`${location.origin}/v/${p().id}`)}
						>
							copy email link
						</button>
						<Show when={videoSummary(p())}>
							<div style={{ color: "var(--orange)" }}>{videoSummary(p())}</div>
						</Show>
					</Show>
					<Show when={p().brainUrl}>
						<a href={p().brainUrl!} target="_blank" rel="noreferrer">brain ↗</a>
					</Show>
				</div>
			</Show>

			<Show when={p().brainUrl}>
				<DigestSection brainUrl={p().brainUrl!} />
			</Show>

			<Show when={p().notes}>
				<p class="muted" style={{ "font-size": "12px", margin: "5px 0" }}>{p().notes}</p>
			</Show>

			<div style={{ "margin-top": "8px" }}>
				<button type="button" class="btn btn-sm" onClick={() => setEditing(!editing())}>
					{editing() ? "Cancel" : "Edit"}
				</button>
			</div>

			<Show when={error()}>
				<p class="login-error">{error()}</p>
			</Show>

			{/* stage select covers touch + keyboard — HTML5 drag doesn't fire there */}
			<Show when={editing()}>
				<form onSubmit={handleSave} style={{ display: "grid", gap: "8px", "margin-top": "8px" }}>
					<input type="hidden" name="id" value={p().id} />
					<select name="stage" value={p().stage}>
						<For each={OUTREACH_STAGES}>{(s) => <option value={s}>{s}</option>}</For>
					</select>
					<input type="datetime-local" name="next_action_at" value={toInputValue(p().nextActionAt)} />
					<input type="text" name="next_action_note" placeholder="Next action note" value={p().nextActionNote ?? ""} />
					<button type="submit" class="btn btn-primary btn-sm">Save</button>
				</form>
			</Show>
		</div>
	);
}

function Board() {
	const outreach = createAsync(() => getOutreachQuery(), { deferStream: true });
	const setStage = useAction(setOutreachStageAction);
	const [draggedId, setDraggedId] = createSignal<string | undefined>();
	const [hoverStage, setHoverStage] = createSignal<string | undefined>();
	const [error, setError] = createSignal("");
	// ponytail: optimistic stage override stays in place after a successful
	// drop (the refetched query matches it anyway); only cleared on error.
	const [overrides, setOverrides] = createSignal<Record<string, string>>({});

	const dueIds = createMemo(() => new Set((outreach()?.due ?? []).map((p) => p.id)));

	const columns = createMemo(() => {
		const all = outreach()?.all ?? [];
		return OUTREACH_STAGES.map((stage) => {
			const cards = all
				.filter((p) => (overrides()[p.id] ?? p.stage) === stage)
				.sort((a, b) => sortCards(a, b, dueIds()));
			return { stage, cards };
		});
	});

	async function handleDrop(e: DragEvent, stage: OutreachStage) {
		e.preventDefault();
		setHoverStage(undefined);
		const id = draggedId() ?? e.dataTransfer?.getData("text/plain");
		setDraggedId(undefined);
		if (!id) return;
		const p = outreach()?.all.find((x) => x.id === id);
		if (!p || p.stage === stage) return;
		setError("");
		setOverrides((o) => ({ ...o, [id]: stage }));
		const fd = new FormData();
		fd.set("id", id);
		fd.set("stage", stage);
		const res = (await setStage(fd)) as { error?: string };
		if (res.error) {
			setOverrides((o) => {
				const n = { ...o };
				delete n[id];
				return n;
			});
			setError(res.error);
		}
	}

	return (
		<div>
			<Show when={error()}>
				<p class="login-error">{error()}</p>
			</Show>
			<Suspense fallback={<p class="muted">Loading…</p>}>
				<Show when={outreach()?.all.length} fallback={<p class="muted">No prospects yet — add one above.</p>}>
					<div class="board">
						<For each={columns()}>
							{(col) => (
								<div
									class="board-col"
									classList={{ "drag-over": hoverStage() === col.stage }}
									onDragOver={(e) => {
										e.preventDefault();
										if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
										setHoverStage(col.stage);
									}}
									onDragLeave={(e) => {
										if (!e.currentTarget.contains(e.relatedTarget as Node)) setHoverStage(undefined);
									}}
									onDrop={(e) => handleDrop(e, col.stage)}
								>
									<div class="board-col-head">
										<span class="dot" style={{ background: STAGE_COLOR[col.stage] }} />
										{col.stage}
										<span class="board-col-count">{col.cards.length}</span>
									</div>
									<div class="board-cards">
										<For each={col.cards}>
											{(p) => <BoardCard prospect={p} due={dueIds().has(p.id)} />}
										</For>
										<Show when={!col.cards.length}>
											<p class="muted" style={{ "font-size": "12px", margin: "0" }}>drop here</p>
										</Show>
									</div>
								</div>
							)}
						</For>
					</div>
				</Show>
			</Suspense>
		</div>
	);
}

export default function AdminOutreach() {
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const createProspect = useAction(createOutreachAction);

	const [error, setError] = createSignal("");
	const [message, setMessage] = createSignal("");

	async function handleCreate(e: Event) {
		e.preventDefault();
		setError("");
		setMessage("");
		const res = (await createProspect(withInstantIso(new FormData(e.target as HTMLFormElement)))) as { error?: string; success?: string };
		if (res.error) {
			setError(res.error);
			return;
		}
		setMessage(res.success ?? "Added.");
		(e.target as HTMLFormElement).reset();
	}

	return (
		<Layout user={user()}>
			<Title>Outreach — Mad Cactus</Title>
			<h1 class="page-title">Outreach Pipeline</h1>
			<p class="page-subtitle">Drag cards between stages. Manual follow-ups for company-brain outreach — no email is sent from here.</p>

			<details style={{ "margin-bottom": "24px" }}>
				<summary style={{ cursor: "pointer", "font-weight": "600" }}>Add prospect</summary>
				<form onSubmit={handleCreate} style={{ display: "grid", gap: "8px", "max-width": "640px", "margin-top": "12px" }}>
					<div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
						<input type="text" name="company" placeholder="Company *" required />
						<input type="text" name="contact_name" placeholder="Contact name" />
						<input type="email" name="email" placeholder="Email" />
					</div>
					<div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
						<input type="url" name="brain_url" placeholder="Brain URL (https://…)" />
						<input type="url" name="video_url" placeholder="Video URL" />
					</div>
					<div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
						<select name="stage">
							<For each={OUTREACH_STAGES}>{(s) => <option value={s}>{s}</option>}</For>
						</select>
						<input type="datetime-local" name="next_action_at" placeholder="First next action" />
						<button type="submit" class="btn btn-primary">Add</button>
					</div>
					<span class="muted" style={{ "font-size": "12px" }}>First next action defaults to 5 days from now.</span>
				</form>
			</details>
			<Show when={error()}>
				<p class="login-error">{error()}</p>
			</Show>
			<Show when={message()}>
				<p class="muted">{message()}</p>
			</Show>

			<Board />
		</Layout>
	);
}
