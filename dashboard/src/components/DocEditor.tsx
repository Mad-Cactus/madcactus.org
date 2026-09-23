import { For, Show, createSignal, onMount, onCleanup } from "solid-js";
import { useNavigate, createAsync } from "@solidjs/router";
import LexicalDocEditor from "~/components/LexicalDocEditor";
import ConfirmButton from "~/components/ConfirmButton";
import { LinkedInPreview, NewsletterEmailPreview, NewsletterWebPreview, type PreviewMode } from "~/components/DocPreviews";
import type { DocEditorApi } from "~/components/LexicalDocEditor";
import { getDocQuery, getDocStatsQuery } from "~/lib/docs-queries";
import { computeBreaks } from "~/lib/doc-pages";
import { VoiceLintPanel } from "~/components/VoiceLintPanel";
import { docSurface, type LintResult } from "~/lib/voice-lint";

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
	const navigate = useNavigate();
	const listUrl = () => (kind() === "newsletter" ? "/admin/newsletters" : kind() === "post" ? "/admin/posts" : "/admin");
	const remove = async (): Promise<{ error?: string } | undefined> => {
		const res = await fetch(`/api/docs/${props.id}`, { method: "DELETE" });
		if (!res.ok) return { error: ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "delete failed" };
		navigate(listUrl());
		return undefined;
	};
	const kind = () => doc().kind ?? null;
	// per-doc reality checks (opens/clicks/requests or linked links) — footer
	// section below the editor column
	const stats = createAsync(() => getDocStatsQuery(props.id));
	const newsletterStats = () => {
		const s = stats();
		return s?.kind === "newsletter" ? s : undefined;
	};
	const postStats = () => {
		const s = stats();
		return s?.kind === "post" ? s : undefined;
	};
	const [docStatus, setDocStatus] = createSignal(doc().status as string);
	const [publishedAt, setPublishedAt] = createSignal(doc().publishedAt?.toISOString() ?? null);
	const [schedFor, setSchedFor] = createSignal<string | null>(doc().scheduledFor?.toISOString() ?? null);
	const [publishError, setPublishError] = createSignal(doc().publishError ?? null);
	const [schedInput, setSchedInput] = createSignal("");
	const [firstComment, setFirstComment] = createSignal("");
	const [channel, setChannel] = createSignal<"email+web" | "web">(doc().publishChannel ?? "email+web");
	// newsletter channel appendix ("After the body" panel): one textarea
	// switched between the two stored fields, autosaved like the first comment
	const [emailAppendix, setEmailAppendix] = createSignal("");
	const [webAppendix, setWebAppendix] = createSignal("");
	const [appendixChannel, setAppendixChannel] = createSignal<"email" | "web">("email");
	let appendixTimer: ReturnType<typeof setTimeout> | undefined;
	const saveAppendix = (channel: "email" | "web", content: string) => {
		(channel === "email" ? setEmailAppendix : setWebAppendix)(content);
		clearTimeout(appendixTimer);
		appendixTimer = setTimeout(() => void post(props.id, { op: "set-appendix", channel, content }), 1200);
	};
	// live web snapshot — differs from markdown() when a published newsletter
	// was edited but not republished yet
	const [webMd, setWebMd] = createSignal(doc().webMarkdown ?? doc().markdown);
	const hasUnpublishedEdits = () => kind() === "newsletter" && docStatus() === "published" && markdown() !== webMd();
	const [genre, setGenre] = createSignal(doc().genre ?? "");
	// inline voice lint — debounced re-check on every markdown/genre change
	const [lint, setLint] = createSignal<LintResult | null>(null);
	const [lintStale, setLintStale] = createSignal(false);
	let lintTimer: ReturnType<typeof setTimeout> | undefined;
	const lintDoc = (md: string, g?: string) => {
		// the overlay needs offsets into the editor's PLAIN text (markdown syntax
		// chars are consumed into formatting), so lint that when available
		const text = docApi?.text() ?? md;
		if (!md.trim()) {
			setLint(null);
			setLintStale(false);
			return;
		}
		setLintStale(true);
		clearTimeout(lintTimer);
		lintTimer = setTimeout(async () => {
			const res = await fetch("/api/lint", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text, surface: docSurface(kind()), genre: (g ?? genre()) || undefined }),
			});
			if (res.ok) {
				setLint(await res.json());
				setLintStale(false);
			}
		}, 700);
	};
	const [liConnected, setLiConnected] = createSignal<boolean | null>(null);
	const [preview, setPreview] = createSignal<PreviewMode | null>(null);
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let fcTimer: ReturnType<typeof setTimeout> | undefined;
	// first comment autosaves like markdown — Schedule persists it too, but a
	// typed comment must survive navigating away without scheduling
	const saveFirstComment = (fc: string) => {
		setFirstComment(fc);
		clearTimeout(fcTimer);
		fcTimer = setTimeout(() => void post(props.id, { op: "set-first-comment", firstComment: fc }), 1200);
	};

	// ── pagination: title + editor blocks measured into letter pages ──
	let pagerEl: HTMLDivElement | undefined;
	let titleEl: HTMLTextAreaElement | undefined;
	let editorRoot: HTMLElement | undefined;
	const pagerRef = (el: HTMLDivElement) => (pagerEl = el);
	const titleRef = (el: HTMLTextAreaElement) => (titleEl = el);
	const setEditorRoot = (root: HTMLElement) => (editorRoot = root);
	let docApi: DocEditorApi | undefined;
	let layoutTimer: ReturnType<typeof setTimeout> | undefined;
	const editing = () => {
		const a = document.activeElement;
		if (!a || a === document.body) return false;
		// parentElement covers Lexical's floating toolbar too — clicking Bold
		// must not trigger an instant re-layout any more than typing does
		const zone = editorRoot?.parentElement;
		return a === titleEl || Boolean(zone && zone.contains(a));
	};
	const caretViewAnchor = (): number | null => {
		const sel = document.getSelection();
		if (!sel || !sel.rangeCount) return null;
		const r = sel.getRangeAt(0).getBoundingClientRect();
		if (r.top || r.bottom) return r.top;
		// collapsed ranges often report a zero rect — fall back to the host block
		const el = sel.anchorNode instanceof HTMLElement ? sel.anchorNode : sel.anchorNode?.parentElement;
		return el ? el.getBoundingClientRect().top : null;
	};
	const runLayout = () => {
		if (!docApi || !pagerEl || !editorRoot) return;
		// re-paginating moves blocks — scroll-compensate so the caret stays
		// visually planted (text snaps around it, no teleport); only while the
		// caret is live in the editor — a stale selection must not scroll-jack
		const anchor = editing() ? caretViewAnchor() : null;
		let r = computeBreaks(pagerEl, titleEl ?? null, editorRoot);
		// tables that cross a boundary split at a row edge, then re-layout;
		// capped — a degenerate table (one huge row) just overflows like before
		for (let i = 0; i < 4 && r.splits.length; i++) {
			if (!docApi.splitTables(r.splits)) break;
			r = computeBreaks(pagerEl, titleEl ?? null, editorRoot);
		}
		if (anchor !== null) {
			const after = caretViewAnchor();
			if (after !== null) window.scrollBy(0, after - anchor);
		}
	};
	const scheduleLayout = () => {
		clearTimeout(layoutTimer);
		// while editing, reconcile after a 1s pause (stale breaks would otherwise
		// leave whitespace holes); unfocused changes settle in 200ms
		layoutTimer = setTimeout(runLayout, editing() ? 1000 : 200);
	};
	onMount(() => {
		const onResize = () => scheduleLayout();
		window.addEventListener("resize", onResize);
		// fonts can shift metrics after first paint
		document.fonts?.ready?.then(() => scheduleLayout());
		onCleanup(() => window.removeEventListener("resize", onResize));
	});

	// seed once when the doc resource resolves
	onMount(() => {
		const stop = setInterval(() => {
			const d = doc();
			if (d) {
				setMarkdown(d.markdown);
				if (d.shareToken) setShareUrl(`${location.origin}/share/${d.shareToken}`);
				if (d.status === "scheduled" && d.scheduledFor) setSchedInput(toLocalInput(new Date(d.scheduledFor)));
				setFirstComment(d.firstComment ?? "");
				setEmailAppendix(d.emailAppendix ?? "");
				setWebAppendix(d.webAppendix ?? "");
				setChannel(d.publishChannel ?? "email+web");
				setGenre(d.genre ?? "");
				if (titleEl) {
					titleEl.style.height = "auto";
					titleEl.style.height = `${titleEl.scrollHeight}px`;
				}
				lintDoc(d.markdown, d.genre ?? "");
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
		return res.json() as Promise<{ ok?: boolean; error?: string; kind?: string | null; genre?: string | null; status?: string; scheduledFor?: string; publishedAt?: string | null; shareToken?: string | null }>;
	};

	const schedule = async () => {
		const when = new Date(schedInput());
		if (Number.isNaN(when.getTime())) {
			setStatus("pick a valid date/time");
			return;
		}
		await save(props.id, markdown());
		const r = await post(props.id, { op: "schedule", scheduledFor: when.toISOString(), firstComment: firstComment(), channel: channel() });
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

	// schedule-at-now: the 60s ticker picks it up — same dispatch path as a
	// scheduled send, so nothing new can break
	const publishNow = async () => {
		await save(props.id, markdown());
		const r = await post(props.id, { op: "schedule", scheduledFor: new Date().toISOString(), channel: channel() });
		if (r.ok) {
			setDocStatus("scheduled");
			setSchedFor(r.scheduledFor ?? new Date().toISOString());
			setPublishError(null);
			setStatus("publishing — goes out within 60 seconds");
		} else setStatus(r.error ?? "publish failed");
	};

	// republish-to-web: snapshot the current markdown as the live version —
	// email never re-sends (publish.ts skips broadcast when publishedAt is set)
	const republishWeb = async () => {
		await save(props.id, markdown());
		const r = await post(props.id, { op: "republish-web", markdown: markdown() });
		if (r.ok) {
			setWebMd(markdown());
			setStatus("web page updated — email not re-sent");
		} else setStatus(r.error ?? "republish failed");
	};

	// manual state fix — posts deleted on LinkedIn, hiding a sent newsletter
	// from the site, or marking something that actually went out
	const setPublishStateState = async (state: "final" | "published") => {
		const r = await post(props.id, { op: "set-publish-state", state });
		if (r.ok && r.status) {
			setDocStatus(r.status);
			setPublishedAt(r.publishedAt ?? null);
			setStatus(state === "published" ? "marked as posted" : "marked as unposted");
		} else setStatus(r.error ?? "state update failed");
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
					<Show when={docStatus() === "published" && (publishedAt() ?? schedFor())}>
						<span class="doc-badge published">Published {new Date(publishedAt() ?? schedFor()!).toLocaleString()} · </span>
					</Show>
					<Show when={docStatus() === "final" && publishedAt()}>
						<span class="doc-badge published">{kind() === "newsletter" ? "Sent" : "Posted"} {new Date(publishedAt()!).toLocaleString()} · marked unposted · </span>
					</Show>
					{status() || `v${verNum()}`}
				</span>
				<div style={{ flex: 1 }} />
				{/* genre scopes the voice rules this doc teaches/lints under — shown
				    for every kind; docs created on /admin/docs have kind=null */}
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
						lintDoc(markdown(), e.currentTarget.value);
					}}
				/>
				<datalist id="doc-genres">
					<option value="marketing" />
					<option value="informational" />
					<option value="casual" />
				</datalist>
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
				<Show when={docStatus() !== "publishing"}>
					<ConfirmButton
						label="Delete"
						confirmText={docStatus() === "scheduled" ? "Delete? Cancels the send" : docStatus() === "published" && kind() === "newsletter" ? "Delete? Also hides it from the site" : "Delete? Removes it from the site"}
						onConfirm={remove}
					/>
				</Show>
				<button type="button" class="btn btn-sm" onClick={async () => {
					const r = await post(props.id, { op: "share", enabled: !shareUrl() });
					setShareUrl(r.shareToken ? `${location.origin}/share/${r.shareToken}` : "");
				}}>
					{shareUrl() ? "Unshare" : "Share"}
				</button>
				<details class="doc-export" ref={(el) => {
				// close on any click outside the menu
				const close = (e: MouseEvent) => {
					if (!(e.target instanceof Element) || !e.target.closest(".doc-export")) el.removeAttribute("open");
				};
				document.addEventListener("click", close);
				onCleanup(() => document.removeEventListener("click", close));
			}}>
				<summary class="btn btn-sm">Export ▾</summary>
				<div class="doc-export-menu">
					<button type="button" onClick={() => {
						const blob = new Blob([markdown()], { type: "text/markdown" });
						const a = document.createElement("a");
						a.href = URL.createObjectURL(blob);
						a.download = `${doc().title.replace(/[^\w-]+/g, "-")}.md`;
						a.click();
						URL.revokeObjectURL(a.href);
					}}>Markdown (.md)</button>
					<button type="button" onClick={async () => {
						await save(props.id, markdown());
						window.open(`/api/docs/${props.id}/export?format=docx`, "_blank");
					}}>Word (.docx)</button>
					<button type="button" onClick={async () => {
						await save(props.id, markdown());
						window.open(`/api/docs/${props.id}/export?format=pdf`, "_blank");
					}}>PDF (.pdf)</button>
				</div>
			</details>
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
							<Show when={kind() === "newsletter"}>
								<select
									class="doc-sched-input"
									aria-label="Publish to"
									value={channel()}
									onChange={(e) => setChannel(e.currentTarget.value as "email+web" | "web")}
								>
									<option value="email+web">Email + web</option>
									<option value="web">Web only</option>
								</select>
							</Show>
							<button type="button" class="btn btn-primary btn-sm" onClick={() => void publishNow()}>
								Publish now
							</button>
							<input
								type="datetime-local"
								class="doc-sched-input"
								aria-label="Publish at"
								value={schedInput()}
								onChange={(e) => setSchedInput(e.currentTarget.value)}
							/>
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
					<Show when={docStatus() === "published"}>
						<Show when={kind() === "newsletter"}>
							{/* live page renders the published snapshot — editing changes
							    nothing until Republish snapshots the new version */}
							<a class="btn btn-sm" target="_blank" href={`/newsletter/${props.id}`}>
								View live page ↗
							</a>
							<Show when={hasUnpublishedEdits()}>
								<button type="button" class="btn btn-primary btn-sm" onClick={() => void republishWeb()}>
									Republish to web
								</button>
							</Show>
						</Show>
						<button type="button" class="btn btn-sm" onClick={() => void setPublishStateState("final")}>
							{kind() === "newsletter" ? "Hide from site" : "Mark as unposted"}
						</button>
					</Show>
					<Show when={docStatus() === "final" || docStatus() === "failed"}>
						<button type="button" class="btn btn-sm" onClick={() => void setPublishStateState("published")}>
							{kind() === "newsletter" ? "Mark as sent" : "Mark as posted"}
						</button>
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
			{/* the pager is the page surface: title + editor measure together so
			    page breaks match the .docx/.pdf exports (see ~/lib/doc-pages) */}
			<div class="doc-pager" ref={pagerRef}>
				<textarea
					class="doc-title"
					ref={titleRef}
					rows={1}
					placeholder={kind() === "newsletter" ? "Subject / title" : "Untitled"}
					title={kind() === "newsletter" ? "The email subject — same text as the web headline" : "Click to rename"}
					onInput={(e) => {
						const el = e.currentTarget;
						el.style.height = "auto";
						el.style.height = `${el.scrollHeight}px`;
					}}
					onChange={(e) => {
						const v = e.currentTarget.value.trim() || "Untitled";
						if (v !== doc().title) void post(props.id, { op: "rename", title: v });
						else e.currentTarget.value = doc().title;
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							e.currentTarget.blur();
							// Enter jumps into the body, like macro's title → doc navigation
							document.querySelector<HTMLDivElement>(".doc-editor")?.focus();
						}
					}}
				>
					{doc().title}
				</textarea>
				<LexicalDocEditor
					markdown={markdown()}
					onBlur={() => scheduleLayout()}
					onMarkdownChange={(md) => {
						// skip the seed-conversion echo (same md) — it would bump the
						// version on every open
						if (md === markdown()) return;
						setMarkdown(md);
						lintDoc(md);
						// autosave to the DB, not just local state — a refresh must not
						// lose the doc
						clearTimeout(saveTimer);
						saveTimer = setTimeout(() => void save(props.id, md), 1200);
					}}
					onSave={(md) => save(props.id, md)}
					onReady={(api) => {
						docApi = api;
						setEditorRoot(api.root);
					}}
					onLayoutDirty={scheduleLayout}
					violations={lint()?.violations ?? []}
				/>
			</div>
			{/* voice lint sits outside the pager so its height never affects page breaks */}
			<VoiceLintPanel result={lint()} stale={lintStale()} />
			{/* first comment is a plain doc field — shown whether or not LinkedIn is
			    connected yet (gating on liConnected unmounted it once the check resolved) */}
			<Show when={kind() === "post"}>
				<div class="doc-firstcomment">
					<label for="first-comment">First comment</label>
					<input
						id="first-comment"
						type="text"
						class="doc-sched-input"
						placeholder="Posted right after publish (optional)"
						value={firstComment()}
						onChange={(e) => saveFirstComment(e.currentTarget.value)}
					/>
				</div>
			</Show>
			<Show when={kind() === "newsletter"}>
				<div class="doc-firstcomment">
					<label for="channel-appendix">After the body</label>
					<div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
						<select
							class="doc-sched-input"
							style={{ width: "110px" }}
							aria-label="Appendix channel"
							value={appendixChannel()}
							onChange={(e) => setAppendixChannel(e.currentTarget.value as "email" | "web")}
						>
							<option value="email">Email</option>
							<option value="web">Web</option>
						</select>
						<textarea
							rows={3}
							class="doc-sched-input"
							style={{ width: "100%" }}
							placeholder="CTA block rendered after the issue body — markdown"
							value={appendixChannel() === "email" ? emailAppendix() : webAppendix()}
							onInput={(e) => saveAppendix(appendixChannel(), e.currentTarget.value)}
						/>
					</div>
				</div>
			</Show>
			<Show when={newsletterStats()}>
				{(s) => (
					<div class="doc-firstcomment" style={{ display: "block", gap: 0 }}>
						<label for="doc-stats">Stats</label>
						<p class="muted" style={{ margin: "4px 0 8px" }} id="doc-stats">
							{s().opens} opens · {s().clicks} clicks · {s().requests} brain requests
						</p>
						<Show when={s().perPerson.length}>
							<table style={{ "font-size": "12px", "border-collapse": "collapse", width: "100%" }}>
								<thead>
									<tr class="muted" style={{ "text-align": "left" }}>
										<th style={{ padding: "2px 12px 2px 0", "font-weight": 500 }}>Recipient</th>
										<th style={{ padding: "2px 12px 2px 0", "font-weight": 500 }}>Opens</th>
										<th style={{ padding: "2px 0", "font-weight": 500 }}>Clicks</th>
									</tr>
								</thead>
								<tbody>
									<For each={s().perPerson}>
										{(p) => (
											<tr>
												<td style={{ padding: "2px 12px 2px 0" }}>{p.recipient ?? "(anon)"}</td>
												<td style={{ padding: "2px 12px 2px 0" }}>{p.opens}</td>
												<td style={{ padding: "2px 0" }}>{p.clicks}</td>
											</tr>
										)}
									</For>
								</tbody>
							</table>
						</Show>
					</div>
				)}
			</Show>
			<Show when={postStats()}>
				{(s) => (
					<div class="doc-firstcomment">
						<label for="doc-links">Linked links</label>
						<span class="muted" id="doc-links">
							<For each={s().links}>
								{(l, i) => (
									<span>
										{i() > 0 ? " · " : ""}/l/{l.slug} ({l.clicks})
									</span>
								)}
							</For>
							<Show when={!s().links.length}>no short links point at this post</Show>
						</span>
					</div>
				)}
			</Show>
				</div>
				<Show when={preview()}>
					<aside class="doc-history wide">
						<div class="doc-history-head">
							{preview() === "linkedin" ? "LinkedIn preview" : preview() === "email" ? "Email preview" : "Web preview"}
						</div>
						<div style={{ "overflow-x": "auto" }}>
							<Show when={preview() === "linkedin"}>
								<LinkedInPreview markdown={markdown()} title={doc().title} firstComment={firstComment()} />
							</Show>
							<Show when={preview() === "email"}>
								<NewsletterEmailPreview markdown={markdown()} title={doc().title} appendix={emailAppendix()} issueNumber={doc().issueNumber} />
							</Show>
							<Show when={preview() === "web"}>
								<NewsletterWebPreview docId={props.id} />
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
