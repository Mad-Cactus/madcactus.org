import { Title } from "@solidjs/meta";
import {
	A,
	createAsync,
	useAction,
	useNavigate,
	useParams,
} from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import Layout from "~/components/Layout";
import Waveform from "~/components/Waveform";
import { getUserQuery } from "~/lib/queries";
import { getWaveformQuery } from "~/lib/waveform";
import {
	getMeetingDraftQuery,
	getProjectsForSelectQuery,
	saveMeetingDraftAction,
	publishMeetingAction,
	type TranscriptBlock,
} from "~/lib/admin-queries";

interface EditableBlock extends TranscriptBlock {
	cut: boolean;
}

function msToTime(ms: number): string {
	const s = Math.floor(ms / 1000);
	return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Block editor for a meeting draft: toggle blocks off, edit text, splice
 *  audio + publish. Cut granularity is the block (speaker turn), not the word. */
export default function MeetingEditor() {
	const params = useParams();
	const docId = () => params.id ?? "";
	const navigate = useNavigate();
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const draft = createAsync(() => getMeetingDraftQuery(docId()), {
		deferStream: true,
	});
	const projects = createAsync(() => getProjectsForSelectQuery(), {
		deferStream: true,
	});
	const saveDraft = useAction(saveMeetingDraftAction);
	const publish = useAction(publishMeetingAction);

	const [blocks, setBlocks] = createSignal<EditableBlock[]>([]);
	const [title, setTitle] = createSignal("");
	const [loaded, setLoaded] = createSignal(false);
	const [projectId, setProjectId] = createSignal("");
	const [msg, setMsg] = createSignal<{ ok: boolean; text: string } | null>(null);
	const [busy, setBusy] = createSignal(false);
	const [audioEl, setAudioEl] = createSignal<HTMLAudioElement>();
	// Server query, not a fetch to /api/waveform — a relative fetch() throws
	// ERR_INVALID_URL during SSR and 500s the page. Re-runs when draft() lands.
	const wave = createAsync(async () => {
		const path = draft()?.audioPath;
		return path ? getWaveformQuery(path) : null;
	}, { deferStream: true });

	// Hydrate local state once the draft arrives (query cache is immutable)
	const d = draft();
	if (d && !loaded()) {
		setTitle(d.title);
		let parsed: TranscriptBlock[] = [];
		try {
			parsed = d.transcriptJson ? JSON.parse(d.transcriptJson) : [];
		} catch {
			parsed = [];
		}
		if (parsed.length === 0 && d.content) {
			// no blocks (manual upload) → one whole-audio block
			parsed = [{ speaker: "Transcript", start_ms: 0, end_ms: 0, text: d.content }];
		}
		setBlocks(parsed.map((b) => ({ ...b, cut: false })));
		setLoaded(true);
	}

	function updateBlock(i: number, patch: Partial<EditableBlock>) {
		setBlocks((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));
	}

	/** Waveform drag-select: cut every block the span touches — or, if they're
	 *  all already cut, restore them (toggle). */
	function selectRange(fromMs: number, toMs: number) {
		const idx = blocks()
			.map((b, i) => (b.end_ms > fromMs && b.start_ms < toMs ? i : -1))
			.filter((i) => i >= 0);
		if (idx.length === 0) return;
		const allCut = idx.every((i) => blocks()[i].cut);
		setBlocks((bs) => bs.map((b, j) => (idx.includes(j) ? { ...b, cut: !allCut } : b)));
	}

	function keptBlocks(): TranscriptBlock[] {
		return blocks()
			.filter((b) => !b.cut && b.text.trim())
			.map(({ cut: _cut, ...b }) => b);
	}

	async function handleSave() {
		setBusy(true);
		setMsg(null);
		const fd = new FormData();
		fd.set("id", docId());
		fd.set("title", title());
		fd.set("blocks_json", JSON.stringify(blocks().map(({ cut: _c, ...b }) => b)));
		const res = (await saveDraft(fd)) as { error?: string } | undefined;
		setMsg({ ok: !res?.error, text: res?.error || "Draft saved." });
		setBusy(false);
	}

	async function handlePublish() {
		if (!projectId()) {
			setMsg({ ok: false, text: "Pick a project first." });
			return;
		}
		if (keptBlocks().length === 0) {
			setMsg({ ok: false, text: "All blocks are cut — nothing to publish." });
			return;
		}
		setBusy(true);
		setMsg(null);
		const fd = new FormData();
		fd.set("id", docId());
		fd.set("project_id", projectId());
		fd.set("blocks_json", JSON.stringify(keptBlocks()));
		const res = (await publish(fd)) as { error?: string } | undefined;
		setBusy(false);
		if (res?.error) {
			setMsg({ ok: false, text: res.error });
		} else {
			navigate("/admin/meetings");
		}
	}

	const audioUrl = () => {
		const p = draft()?.audioPath;
		return p ? `/api/download?path=${encodeURIComponent(p)}` : null;
	};

	return (
		<Layout user={user()}>
			<Title>Edit Meeting — Mad Cactus</Title>
			<div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "24px" }}>
				<div>
					<h1 class="page-title">Edit Meeting</h1>
					<p class="page-subtitle" style={{ "margin-bottom": "0" }}>
						<A class="gold" href="/admin/meetings">
							← Meetings
						</A>
					</p>
				</div>
			</div>

			<Suspense fallback={<p class="muted">Loading…</p>}>
				<Show when={loaded()}>
					<div class="card" style={{ padding: "16px", "margin-bottom": "16px", display: "flex", "flex-direction": "column", gap: "12px" }}>
						<div class="form-group" style={{ "margin-bottom": "0" }}>
							<label for="mt_title">Title</label>
							<input
								id="mt_title"
								type="text"
								value={title()}
								onInput={(e) => setTitle(e.currentTarget.value)}
								style={{ "font-weight": "600" }}
							/>
						</div>
						<Show when={audioUrl()}>
							{/* eslint-disable-next-line jsx-a11y/media-has-caption */}
							<audio ref={setAudioEl} controls preload="none" src={audioUrl()!} style={{ width: "100%" }} />
						</Show>
						<Show when={wave()}>
							<Waveform
								peaks={wave()!.peaks}
								durationMs={wave()!.durationMs}
								regions={() => blocks().map((b) => ({ start_ms: b.start_ms, end_ms: b.end_ms, cut: b.cut }))}
								audio={audioEl()}
								onSelectRange={selectRange}
							/>
							<div class="muted" style={{ "font-size": "12px" }}>
								Click to seek · drag across the wave to cut (or restore) everything in that span
							</div>
						</Show>
						<div class="muted" style={{ "font-size": "12px" }}>
							Unchecked blocks are cut from the transcript <Show when={audioUrl()}>and spliced out of the audio</Show>.
						</div>
					</div>

					<div style={{ display: "flex", "flex-direction": "column", gap: "8px", "margin-bottom": "16px" }}>
						<For each={blocks()}>
							{(b, i) => (
								<div
									class="card"
									style={{
										padding: "12px",
										opacity: b.cut ? "0.45" : "1",
										border: b.cut ? "1px dashed var(--border, #ccc)" : undefined,
									}}
								>
									<div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "6px" }}>
										<input
											type="checkbox"
											checked={!b.cut}
											onChange={(e) => updateBlock(i(), { cut: !e.currentTarget.checked })}
											id={`blk_${i()}`}
											aria-label={`Keep block ${i() + 1}`}
										/>
										<label for={`blk_${i()}`} style={{ "font-weight": "600", cursor: "pointer" }}>
											{b.speaker}
											<Show when={b.end_ms > 0}>
												<span class="muted" style={{ "font-weight": "400", "font-size": "12px" }}>
													{" "}
													· {msToTime(b.start_ms)}–{msToTime(b.end_ms)}
												</span>
											</Show>
										</label>
									</div>
									<textarea
										rows={Math.max(2, Math.ceil(b.text.length / 90))}
										value={b.text}
										onInput={(e) => updateBlock(i(), { text: e.currentTarget.value })}
										disabled={b.cut}
										style={{ width: "100%", "font-size": "13px" }}
									/>
								</div>
							)}
						</For>
					</div>

					<div class="card" style={{ padding: "16px", display: "flex", "flex-wrap": "wrap", gap: "12px", "align-items": "center", position: "sticky", bottom: "0" }}>
						<div class="form-group" style={{ "margin-bottom": "0", "flex": "1", "min-width": "220px" }}>
							<label for="mt_project">Project</label>
							<select id="mt_project" value={projectId()} onChange={(e) => setProjectId(e.currentTarget.value)}>
								<option value="" disabled>
									Assign to project…
								</option>
								<For each={projects() ?? []}>
									{(p) => (
										<option value={p.id}>
											{p.companyName} — {p.name}
										</option>
									)}
								</For>
							</select>
						</div>
						<Show when={msg()}>
							<span class={msg()!.ok ? "muted" : "badge badge-paused"} style={{ "font-size": "12px" }}>
								{msg()!.text}
							</span>
						</Show>
						<button class="btn" onClick={handleSave} disabled={busy()}>
							Save Draft
						</button>
						<button class="btn btn-primary" onClick={handlePublish} disabled={busy()}>
							{busy() ? "Working…" : "Publish"}
						</button>
					</div>
				</Show>
			</Suspense>
		</Layout>
	);
}
