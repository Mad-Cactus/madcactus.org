import { For, Show, createSignal, onMount } from "solid-js";
import LexicalDocEditor from "~/components/LexicalDocEditor";
import { LinkedInPreview, NewsletterEmailPreview, NewsletterWebPreview, type PreviewMode } from "~/components/DocPreviews";
import { getDocQuery } from "~/lib/docs-queries";

type VersionRow = {
	id: string;
	version: number;
	author: string;
	createdAt: string;
	updatedAt: string;
};
type DiffPart = { added?: boolean; removed?: boolean; value: string };

const toLocalInput = (d: Date) => {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const DocEditor = (props: { id: string; doc: NonNullable<Awaited<ReturnType<typeof getDocQuery>>> }) => {
	const doc = () => props.doc;
	const [markdown, setMarkdown] = createSignal("");
	const [status, setStatus] = createSignal("");
	const [shareUrl, setShareUrl] = createSignal("");
	const [verNum, setVerNum] = createSignal(doc().version);
	const [showHistory, setShowHistory] = createSignal(false);
	const [versions, setVersions] = createSignal<VersionRow[]>([]);
	const [sel, setSel] = createSignal<number | null>(null);
	const [diff, setDiff] = createSignal<DiffPart[] | null>(null);
	// kind is set at creation (which tab you made it in) — the editor adapts
	const kind = () => doc().kind ?? null;
	const [docStatus, setDocStatus] = createSignal(doc().status as string);
	const [schedFor, setSchedFor] = createSignal<string | null>(doc().scheduledFor?.toISOString() ?? null);
	const [publishError, setPublishError] = createSignal(doc().publishError ?? null);
	const [schedInput, setSchedInput] = createSignal("");
	const [firstComment, setFirstComment] = createSignal("");
	const [genre, setGenre] = createSignal(doc().genre ?? "");
	const [liConnected, setLiConnected] = createSignal<boolean | null>(null);
	const [preview, setPreview] = createSignal<PreviewMode | null>(null);
	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	// seed once when the doc resource resolves
	onMount(() => {
		const stop = setInterval(() => {
			const d = doc();
			if (d) {
				setMarkdown(d.markdown);
				if (d.shareToken) setShareUrl(`${location.origin}/share/${d.shareToken}`);
				if (d.status === "scheduled" && d.scheduledFor) setSchedInput(toLocalInput(new Date(d.scheduledFor)));
				setFirstComment(d.firstComment ?? "");
				setGenre(d.genre ?? "");
				clearInterval(stop);
			}
		}, 50);
		// LinkedIn connect state only gates kind=post; null = still checking
		if (doc().kind === "post") {
			void fetch("/api/social/linkedin")
				.then((r) => (r.ok ? r.json() : { connected: false }))
				.then((s: { connected: boolean }) => setLiConnected(Boolean(s.connected)));
		}
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
		return res.json() as Promise<{ ok?: boolean; error?: string; kind?: string | null; genre?: string | null; status?: string; scheduledFor?: string; shareToken?: string | null }>;
	};

	const schedule = async () => {
		const when = new Date(schedInput());
		if (Number.isNaN(when.getTime())) {
			setStatus("pick a valid date/time");
			return;
		}
		await save(props.id, markdown());
		const r = await post(props.id, { op: "schedule", scheduledFor: when.toISOString(), firstComment: firstComment() });
		if (r.ok) {
			setDocStatus("scheduled");
			setSchedFor(r.scheduledFor ?? when.toISOString());
			setPublishError(null);
			setStatus(`scheduled for ${when.toLocaleString()}`);
		} else setStatus(r.error ?? "schedule failed");
	};

	const unschedule = async () => {
		const r = await post(props.id, { op: "unschedule" });
		if (r.ok) {
			setDocStatus("final");
			setSchedFor(null);
			setStatus("unscheduled");
		} else setStatus(r.error ?? "unschedule failed");
	};

	return (
		<>
			<div class="doc-shell">
				<div class="doc-main">
			{/* macro-style: slim chrome row, then the title reads as the first
			    line of the document itself */}
			<div class="doc-topbar">
				<span>
					<Show when={docStatus() === "scheduled" && schedFor()}>
						<span class="doc-badge sched">Scheduled {new Date(schedFor()!).toLocaleString()} · </span>
					</Show>
					<Show when={docStatus() === "published" && schedFor()}>
						<span class="doc-badge published">Published {new Date(schedFor()!).toLocaleString()} · </span>
					</Show>
					{status() || `v${verNum()}`}
				</span>
				<div style={{ flex: 1 }} />
				<Show when={kind()}>
					{/* genre scopes the voice rules this doc teaches/lints under */}
					<input
						type="text"
						class="doc-sched-input"
						aria-label="Genre"
						placeholder="genre"
						list="doc-genres"
						value={genre()}
						onChange={(e) => {
							setGenre(e.currentTarget.value);
							void post(props.id, { op: "set-genre", genre: e.currentTarget.value });
						}}
					/>
					<datalist id="doc-genres">
						<option value="marketing" />
						<option value="informational" />
						<option value="casual" />
					</datalist>
				</Show>
				<Show when={kind() === "post"}>
					<button type="button" class="btn btn-sm" classList={{ active: preview() === "linkedin" }} onClick={() => setPreview(preview() === "linkedin" ? null : "linkedin")}>
						Preview
					</button>
				</Show>
				<Show when={kind() === "newsletter"}>
					<button type="button" class="btn btn-sm" classList={{ active: preview() === "email" }} onClick={() => setPreview(preview() === "email" ? null : "email")}>
						Email
					</button>
					<button type="button" class="btn btn-sm" classList={{ active: preview() === "web" }} onClick={() => setPreview(preview() === "web" ? null : "web")}>
						Web
					</button>
				</Show>
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
				<Show
					when={kind()}
					fallback={
						<button type="button" class="btn btn-primary btn-sm" onClick={async () => {
							await save(props.id, markdown());
							const r = await post(props.id, { op: "finalize" });
							setStatus(r.ok ? "marked final" : (r.error ?? "finalize failed"));
						}}>
							Finalize
						</button>
					}
				>
					<Show when={kind() === "post" && liConnected() !== true} fallback={
						<>
							<input
								type="datetime-local"
								class="doc-sched-input"
								aria-label="Publish at"
								value={schedInput()}
								onChange={(e) => setSchedInput(e.currentTarget.value)}
							/>
							<Show when={kind() === "post"}>
								<input
									type="text"
									class="doc-sched-input"
									aria-label="First comment (posted right after publish)"
									placeholder="First comment (optional)"
									value={firstComment()}
									onChange={(e) => setFirstComment(e.currentTarget.value)}
								/>
							</Show>
							<button type="button" class="btn btn-primary btn-sm" onClick={() => void schedule()}>
								{docStatus() === "scheduled" ? "Reschedule" : "Schedule"}
							</button>
							<Show when={docStatus() === "scheduled"}>
								<button type="button" class="btn btn-sm" onClick={() => void unschedule()}>
									Unschedule
								</button>
							</Show>
						</>
					}>
						<a class="btn btn-sm" target="_top" href="/api/social/linkedin?start=1">Connect LinkedIn to schedule</a>
					</Show>
				</Show>
			</div>
			<Show when={docStatus() === "failed" && publishError()}>
				<p class="doc-publish-error" role="alert">
					Publish failed: {publishError()} — reschedule to retry.
				</p>
			</Show>
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
				<Show when={preview()}>
					<aside class="doc-history">
						<div class="doc-history-head">
							{preview() === "linkedin" ? "LinkedIn preview" : preview() === "email" ? "Email preview" : "Web preview"}
						</div>
						<div style={{ "overflow-x": "auto" }}>
							<Show when={preview() === "linkedin"}>
								<LinkedInPreview markdown={markdown()} title={doc().title} firstComment={firstComment()} />
							</Show>
							<Show when={preview() === "email"}>
								<NewsletterEmailPreview markdown={markdown()} title={doc().title} />
							</Show>
							<Show when={preview() === "web"}>
								<NewsletterWebPreview markdown={markdown()} title={doc().title} />
							</Show>
						</div>
					</aside>
				</Show>
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
