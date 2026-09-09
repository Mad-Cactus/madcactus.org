import { Title } from "@solidjs/meta";
import { createAsync, revalidate, useAction, useSearchParams } from "@solidjs/router";
import { For, Show, createSignal, createEffect, onMount, onCleanup } from "solid-js";
import Layout from "~/components/Layout";
import {
	getInboxQuery,
	syncEmailAction,
	getEmailStatusQuery,
} from "~/lib/email-queries";
import type { EmailThread, EmailMessage, EmailOutbox } from "~/db/schema";

type DraftVersionRow = { id: string; version: number; author: string; createdAt: string; updatedAt: string };
type DraftDiffPart = { added?: boolean; removed?: boolean; value: string };

// Hotkeys mirror macro: j/k move + open, h/l list↔pane, e archive, shift+e
// unarchive, u unread, r reply, f forward, c compose, / search, Esc close.
// V = visual multi-select: j/k extend the range, then e/u/!/# act on all of it.

type ThreadFull = { thread: EmailThread; messages: EmailMessage[] };

export default function AdminEmail() {
	const status = createAsync(() => getEmailStatusQuery(), { deferStream: true });
	const [searchParams, setSearchParams] = useSearchParams();
	// folder lives in the URL so a search keeps the tab it was typed in
	const folder = (): "inbox" | "drafts" | "outbox" | "sent" =>
		searchParams.folder === "drafts" || searchParams.folder === "outbox" || searchParams.folder === "sent" ? searchParams.folder : "inbox";
	const setFolder = (f: "inbox" | "drafts" | "outbox" | "sent") => setSearchParams({ folder: f === "inbox" ? undefined : f });
	const activeQ = () => (typeof searchParams.q === "string" && searchParams.q ? searchParams.q : undefined);
	const inbox = createAsync(() => getInboxQuery({ q: activeQ() }), { deferStream: true });
	const sync = useAction(syncEmailAction);

	const [q, setQ] = createSignal(String(searchParams.q ?? ""));
	const [selected, setSelected] = createSignal<ThreadFull | null>(null);
	// older messages collapse to one line — the latest stays expanded; this is
	// the index of a manually expanded one, reset on every thread paint
	const [openMsg, setOpenMsg] = createSignal(-1);
	const [selIdx, setSelIdx] = createSignal(0);
	// optimistic triage state — ops mutate these instead of refetching the
	// whole list; the next sync (≤10min or the Sync button) reconciles
	const [hiddenIds, setHiddenIds] = createSignal<Set<string>>(new Set());
	const [readOverride, setReadOverride] = createSignal<Record<string, boolean>>({});
	const visibleThreads = () => (inbox()?.threads ?? []).filter((t) => !hiddenIds().has(t.id));
	const isUnread = (t: EmailThread) => readOverride()[t.id] ?? t.unread;
	// confirmation modal for destructive macros (spam / delete / unsubscribe)
	const [pending, setPending] = createSignal<{ title: string; body: string; confirm: string; danger: boolean; run: () => Promise<unknown> } | null>(null);
	// visual multi-select (V): range = anchor..cursor, ops apply to the range
	const [visMode, setVisMode] = createSignal(false);
	const [visAnchor, setVisAnchor] = createSignal(0);
	const visRangeIdx = () => [Math.min(visAnchor(), selIdx()), Math.max(visAnchor(), selIdx())] as const;
	const visRangeIds = (): string[] => {
		if (!visMode()) return [];
		const [a, b] = visRangeIdx();
		return visibleThreads().slice(a, b + 1).map((t) => t.id);
	};
	const [compose, setCompose] = createSignal<{ to: string; subject: string; body: string; threadId?: string } | null>(null);
	// client-side windowing over the full local corpus — no server pagination
	const [visibleCount, setVisibleCount] = createSignal(50);
	const [editBody, setEditBody] = createSignal<Record<string, string>>({});
	// locally edited to/subject — shown until the next list revalidate
	const [editMeta, setEditMeta] = createSignal<Record<string, { to?: string; subject?: string }>>({});
	const [sendStatus, setSendStatus] = createSignal("");
	const [connecting, setConnecting] = createSignal(false);
	// per-draft CRDT history (Drafts tab); clicking a draft row opens the
	// corner editor for that draft id
	const [openDraft, setOpenDraft] = createSignal<string | null>(null);
	const [openDraftHistory, setOpenDraftHistory] = createSignal<string | null>(null);
	const [draftVersions, setDraftVersions] = createSignal<Record<string, DraftVersionRow[]>>({});
	const [draftDiff, setDraftDiff] = createSignal<{ id: string; parts: DraftDiffPart[] | null } | null>(null);
	const draftSaveTimers: Record<string, ReturnType<typeof setTimeout>> = {};

	// Linear/Superhuman trick: the pane paints from an in-memory thread cache
	// and neighbors are prefetched after each move — j/k almost always hits
	// memory. Session-scoped; ponytail: cached threads never refresh in the
	// background — a reply landing mid-session appears on next reload/sync.
	const threadCache = new Map<string, ThreadFull>();
	const cacheThread = (d: ThreadFull) => {
		if (threadCache.size > 100) threadCache.clear();
		threadCache.set(d.thread.id, d);
	};
	const prefetch = (t?: EmailThread) => {
		if (!t || threadCache.has(t.id)) return;
		void fetch(`/api/email/threads/${t.id}`)
			.then((r) => (r.ok ? (r.json() as Promise<ThreadFull>) : null))
			.then((d) => d && cacheThread(d))
			.catch(() => {});
	};
	// folder-aware nav list: j/k walks whatever tab is up — inbox rows or the
	// Sent tab's threads. Triage ops (V/e/u/!/#/x) stay inbox-only.
	const listThreads = () =>
		folder() === "sent" ? (inbox()?.sent ?? []).map((s) => s.thread) : visibleThreads();

	// fast j/j/j fires overlapping fetches — abort the stale one so a slow
	// earlier response can't overwrite the newer selection (out-of-order race)
	let threadAbort: AbortController | null = null;
	const loadThread = async (t: EmailThread, i?: number) => {
		if (i !== undefined) setSelIdx(i);
		const idx = i ?? selIdx();
		const list = listThreads();
		prefetch(list[idx - 1]);
		prefetch(list[idx + 1]);
		const paint = (data: ThreadFull) => {
			setSelected(data);
			setOpenMsg(-1);
			const row = document.querySelectorAll("[data-thread-row]")[idx];
			row?.scrollIntoView({ block: "nearest" });
		};
		const markRead = (ac?: AbortController) => {
			if (!isUnread(t)) return;
			setReadOverride({ ...readOverride(), [t.id]: false }); // dim the dot now
			void fetch(`/api/email/threads/${t.id}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ op: "read" }),
				signal: ac?.signal,
			});
		};
		const hit = threadCache.get(t.id);
		if (hit) {
			paint(hit);
			markRead();
			return;
		}
		threadAbort?.abort();
		const ac = new AbortController();
		threadAbort = ac;
		try {
			const res = await fetch(`/api/email/threads/${t.id}`, { signal: ac.signal });
			if (!res.ok) return;
			const data = (await res.json()) as ThreadFull;
			if (ac.signal.aborted) return;
			cacheThread(data);
			paint(data);
			markRead(ac);
		} catch (e) {
			if ((e as Error).name !== "AbortError") throw e;
		}
	};

	// set by threadOp when a row-removing op lands — the inbox effect then
	// selects the thread above so triage continues from the same spot
	let cursorToRestore: number | null = null;

	const flash = (msg: string, ms = 6000) => {
		setSendStatus(msg);
		setTimeout(() => setSendStatus(""), ms);
	};

	const threadOp = async (id: string, op: string): Promise<boolean> => {
		const res = await fetch(`/api/email/threads/${id}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ op }),
		});
		if (!res.ok) {
			// surface server errors — silent no-ops looked like "delete is broken"
			const r = (await res.json().catch(() => ({}))) as { error?: string };
			flash(`failed: ${r.error ?? `HTTP ${res.status}`}`);
			return false;
		}
		const removing = op === "archive" || op === "spam" || op === "delete";
		if (removing) {
			cursorToRestore = Math.max(selIdx() - 1, 0);
			setHiddenIds(new Set([...hiddenIds(), id]));
		} else if (op === "unread") {
			setReadOverride({ ...readOverride(), [id]: true });
		} else if (op === "unarchive") {
			const next = new Set(hiddenIds());
			next.delete(id); // brings the row back into the inbox list
			setHiddenIds(next);
		}
		setSelected(null);
		return true;
	};

	// bulk apply over the visual selection: one fetch per thread, one revalidate
	// at the end (per-op revalidates would reload the cursor N times)
	const bulkOp = async (ids: string[], op: string) => {
		if (!ids.length) return;
		let ok = 0;
		let lastErr = "";
		for (const id of ids) {
			const res = await fetch(`/api/email/threads/${id}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ op }),
			});
			if (res.ok) ok++;
			else lastErr = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`;
		}
		if (op === "archive" || op === "spam" || op === "delete") {
			cursorToRestore = Math.max(visRangeIdx()[0] - 1, 0);
			setHiddenIds(new Set([...hiddenIds(), ...ids]));
		} else if (op === "unread") {
			const overrides = { ...readOverride() };
			for (const id of ids) overrides[id] = true;
			setReadOverride(overrides);
		}
		setVisMode(false);
		setSelected(null);
		flash(lastErr ? `${op}: ${ok}/${ids.length} ok — last error: ${lastErr}` : `${op}: ${ok} threads`, 8000);
	};

	// draft id currently blocked by the voice send gate — its Send button
	// becomes "Send anyway", and overriding feeds the pattern-adaptation signal
	const [lintBlockedDraft, setLintBlockedDraft] = createSignal<string | null>(null);
	// per-draft schedule-send state — mirrors sendDraft's lint-gate UX
	const [schedInput, setSchedInput] = createSignal<Record<string, string>>({});
	const [lintBlockedSched, setLintBlockedSched] = createSignal<string | null>(null);
	const sendDraft = async (outboxId: string, overrideLint = false) => {
		setSendStatus("sending…");
		const res = await fetch(`/api/email/drafts/${outboxId}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ op: "send", body: editBody()[outboxId], overrideLint }),
		});
		const r = await res.json();
		if (r.ok) {
			setLintBlockedDraft(null);
			setSendStatus("sent");
			setTimeout(() => setSendStatus(""), 5000);
			void revalidate("email-inbox"); // move the row from drafts to Sent immediately
		} else if (r.blocked === "voice_lint") {
			const first = r.violations?.[0]?.rule ?? "voice issues";
			const more = (r.violations?.length ?? 1) - 1;
			setLintBlockedDraft(outboxId);
			setSendStatus(`voice lint: ${first}${more > 0 ? ` (+${more} more)` : ""} — fix the draft or send anyway`);
		} else {
			setLintBlockedDraft(null);
			setSendStatus(`failed: ${r.error}`);
		}
	};

	const discardDraft = async (outboxId: string) => {
		await fetch(`/api/email/drafts/${outboxId}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ op: "discard" }),
		});
		void revalidate("email-inbox");
	};

	const scheduleDraft = async (outboxId: string, overrideLint = false) => {
		const raw = schedInput()[outboxId];
		const when = raw ? new Date(raw) : null;
		if (!when || Number.isNaN(when.getTime())) {
			setSendStatus("pick a date/time first");
			return;
		}
		const res = await fetch(`/api/email/drafts/${outboxId}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ op: "schedule", sendAt: when.toISOString(), body: editBody()[outboxId], overrideLint }),
		});
		const r = await res.json();
		if (r.ok) {
			setLintBlockedSched(null);
			setSendStatus(`scheduled for ${when.toLocaleString()}`);
			setTimeout(() => setSendStatus(""), 5000);
			void revalidate("email-inbox");
		} else if (r.blocked === "voice_lint") {
			const first = r.violations?.[0]?.rule ?? "voice issues";
			setLintBlockedSched(outboxId);
			setSendStatus(`voice lint: ${first} — fix the draft or schedule anyway`);
		} else {
			setSendStatus(`failed: ${r.error}`);
		}
	};

	const unscheduleDraft = async (outboxId: string) => {
		await fetch(`/api/email/drafts/${outboxId}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ op: "unschedule" }),
		});
		void revalidate("email-inbox");
	};

	// draft autosave — debounced PUT for body/to/subject; body is CRDT-tracked
	// server-side (hunks into the Loro snapshot, coalesced version rows)
	const editDraft = (outboxId: string, patch: { body?: string; to?: string; subject?: string }) => {
		if (patch.body !== undefined) setEditBody({ ...editBody(), [outboxId]: patch.body });
		if (patch.to !== undefined || patch.subject !== undefined) {
			setEditMeta({ ...editMeta(), [outboxId]: { ...editMeta()[outboxId], ...patch } });
		}
		clearTimeout(draftSaveTimers[outboxId]);
		draftSaveTimers[outboxId] = setTimeout(async () => {
			const payload: Record<string, string> = {};
			if (editBody()[outboxId] !== undefined) payload.body = editBody()[outboxId];
			const m = editMeta()[outboxId];
			if (m?.to !== undefined) payload.to = m.to;
			if (m?.subject !== undefined) payload.subject = m.subject;
			const res = await fetch(`/api/email/drafts/${outboxId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			if (res.ok && openDraftHistory() === outboxId) {
				const r = await fetch(`/api/email/drafts/${outboxId}?versions=1`);
				if (r.ok) setDraftVersions({ ...draftVersions(), [outboxId]: ((await r.json()) as { versions: DraftVersionRow[] }).versions });
			}
		}, 1000);
	};

	const toggleDraftHistory = async (outboxId: string) => {
		if (openDraftHistory() === outboxId) {
			setOpenDraftHistory(null);
			return;
		}
		setOpenDraftHistory(outboxId);
		setDraftDiff(null);
		const r = await fetch(`/api/email/drafts/${outboxId}?versions=1`);
		if (r.ok) setDraftVersions({ ...draftVersions(), [outboxId]: ((await r.json()) as { versions: DraftVersionRow[] }).versions });
	};

	const showDraftDiff = async (outboxId: string, version: number) => {
		setDraftDiff({ id: outboxId, parts: null });
		const r = await fetch(`/api/email/drafts/${outboxId}?diff=${version}`);
		if (r.ok) setDraftDiff({ id: outboxId, parts: ((await r.json()) as { parts: DraftDiffPart[] }).parts });
	};

	const confirmPending = async () => {
		const p = pending();
		setPending(null);
		if (p) await p.run();
	};

	const askSpam = () => {
		const s = selected();
		if (!s) return;
		setPending({
			title: "Report spam?",
			body: `Mark "${s.thread.subject}" from ${s.thread.fromEmail} as spam and drop it from your inbox.`,
			confirm: "Report spam",
			danger: true,
			run: () => threadOp(s.thread.id, "spam"),
		});
	};

	const askDelete = () => {
		const s = selected();
		if (!s) return;
		setPending({
			title: "Delete thread?",
			body: `Move "${s.thread.subject}" from ${s.thread.fromEmail} to trash (recoverable in Gmail).`,
			confirm: "Delete",
			danger: true,
			run: () => threadOp(s.thread.id, "delete"),
		});
	};

	// bulk destructive ops over the visual selection — one confirm for the batch
	const askBulk = (op: "spam" | "delete", ids: string[]) => {
		const n = ids.length;
		if (!n) return;
		const del = op === "delete";
		setPending({
			title: del ? `Delete ${n} threads?` : `Report spam on ${n} threads?`,
			body: del
				? `Move ${n} selected threads to trash (recoverable in Gmail).`
				: `Mark ${n} selected threads as spam and drop them from your inbox.`,
			confirm: del ? "Delete" : "Report spam",
			danger: true,
			run: () => bulkOp(ids, op),
		});
	};

	const askUnsub = async () => {
		const s = selected();
		if (!s) return;
		setSendStatus("looking for unsubscribe info…");
		const res = await fetch(`/api/email/threads/${s.thread.id}/unsubscribe`);
		const info = (await res.json()) as { target: string; type: "http" | "mailto"; oneClick: boolean; subject?: string } | null;
		if (!info) {
			setSendStatus("No unsubscribe info found in this thread.");
			setTimeout(() => setSendStatus(""), 5000);
			return;
		}
		const what = info.type === "http"
			? `One-click unsubscribe from ${new URL(info.target).host}${info.oneClick ? "" : " (plain POST)"} — the thread gets archived.`
			: `This sends an unsubscribe email to ${info.target} — the thread gets archived.`;
		setPending({
			title: "Unsubscribe?",
			body: what,
			confirm: "Unsubscribe",
			danger: false,
			run: async () => {
				const r = await fetch(`/api/email/threads/${s.thread.id}/unsubscribe`, { method: "POST" });
				const j = (await r.json()) as { ok?: boolean; via?: string; error?: string };
				setSendStatus(j.ok ? (j.via === "one-click" ? "Unsubscribed (one-click). Thread archived." : "Unsubscribe email sent. Thread archived.") : `unsubscribe failed: ${j.error}`);
				setTimeout(() => setSendStatus(""), 6000);
			},
		});
	};

	const manualCompose = async () => {
		const c = compose();
		if (!c?.to || !c.body) return;
		const res = await fetch("/api/email/drafts", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(c),
		});
		setCompose(null);
		// drafts are drafts: they land in the Drafts tab for review + the real
		// send (voice-lint gate included), they don't fire straight out
		void revalidate("email-inbox");
		flash("Draft saved — find it in the Drafts tab");
	};

	// ── hotkeys ──
	let searchEl: HTMLInputElement | undefined;
	onMount(() => {
		const handler = async (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			const typing = ["INPUT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable;
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") return; // palette handles
			if (typing) return;
			// confirm modal is up: it owns the keyboard — Enter runs, Escape
			// cancels (keeping the selection), everything else is swallowed.
			// Must sit above the global "/" and Escape branches.
			if (pending()) {
				if (e.key === "Enter") {
					e.preventDefault();
					void confirmPending();
				} else if (e.key === "Escape") {
					e.preventDefault();
					setPending(null);
				}
				return;
			}
			const threads = listThreads();
			if (e.key === "/") {
				e.preventDefault();
				searchEl?.focus();
				return;
			}
			if (e.key === "Escape") {
				if (visMode()) {
					setVisMode(false);
					return;
				}
				setSelected(null);
				setCompose(null);
				setOpenDraft(null);
				return;
			}
			if (compose() || openDraft()) return;
			if (e.key === "c") {
				setCompose({ to: "", subject: "", body: "" });
				return;
			}
			// h/l cycle the folder tabs (wrap) — works on every tab
			if (e.key === "h" || e.key === "l") {
				e.preventDefault();
				const folders = ["inbox", "drafts", "outbox", "sent"] as const;
				const i = folders.indexOf(folder());
				setFolder(folders[(i + (e.key === "l" ? 1 : -1) + folders.length) % folders.length]);
				setSelected(null);
				setVisMode(false);
				return;
			}
			// j/k navigate the list on Inbox AND Sent; Drafts/Outbox have no list.
			// The ops below (V/e/u/!/#/x, r/f) stay inbox-scoped.
			if (folder() === "inbox" || folder() === "sent") {
			const cur = selected() ? selIdx() : -1;
			const move = async (i: number) => {
				if (i < 0 || i >= threads.length) return;
				if (i >= visibleCount()) setVisibleCount(i + 100);
				if (visMode()) {
					setSelIdx(i);
					document.querySelectorAll("[data-thread-row]")[i]?.scrollIntoView({ block: "nearest" });
					return;
				}
				const t = threads[i];
				if (t) await loadThread(t, i);
			};
			if (e.key === "j" || e.key === "ArrowDown") {
				e.preventDefault();
				await move(Math.min(cur + 1, threads.length - 1));
				return;
			} else if (e.key === "k" || e.key === "ArrowUp") {
				e.preventDefault();
				await move(Math.max(cur - 1, 0));
				return;
			}
			}
			// remaining thread hotkeys only make sense in the inbox tab
			if (folder() !== "inbox") return;
			if (e.key === "V" && threads.length) {
				e.preventDefault();
				setVisAnchor(Math.max(selIdx(), 0));
				setVisMode(!visMode());
			} else if (e.key === "e") {
				if (visMode()) await bulkOp(visRangeIds(), "archive");
				else if (selected()) await threadOp(selected()!.thread.id, "archive");
			} else if (e.key === "E" && !visMode() && selected()) {
				await threadOp(selected()!.thread.id, "unarchive");
			} else if (e.key === "u") {
				if (visMode()) await bulkOp(visRangeIds(), "unread");
				else if (selected()) {
					await threadOp(selected()!.thread.id, "unread");
					setSelected(null);
				}
			} else if (e.key === "!") {
				if (visMode()) askBulk("spam", visRangeIds());
				else if (selected()) askSpam();
			} else if (e.key === "#") {
				if (visMode()) askBulk("delete", visRangeIds());
				else if (selected()) askDelete();
			} else if (e.key === "x" && !visMode() && selected()) {
				void askUnsub();
			} else if (e.key === "r" && !visMode() && selected()) {
				const last = selected()!.messages.filter((m) => !m.isSent).at(-1);
				setCompose({
					to: last?.fromEmail ?? "",
					subject: selected()!.thread.subject.startsWith("Re:") ? selected()!.thread.subject : `Re: ${selected()!.thread.subject}`,
					body: `\n\n---\nOn ${last ? new Date(last.date).toLocaleString() : ""}, ${last?.fromEmail ?? ""} wrote:\n${(last?.bodyText ?? "").slice(0, 2000)}`,
					threadId: selected()!.thread.id,
				});
			} else if (e.key === "f" && !visMode() && selected()) {
				const last = selected()!.messages.at(-1);
				setCompose({
					to: "",
					subject: selected()!.thread.subject.startsWith("Fwd:") ? selected()!.thread.subject : `Fwd: ${selected()!.thread.subject}`,
					body: `\n\n---\nForwarded message from ${last?.fromEmail ?? ""}:\n${(last?.bodyText ?? "").slice(0, 2000)}`,
				});
			}
		};
		window.addEventListener("keydown", handler);
		onCleanup(() => window.removeEventListener("keydown", handler));
	});

	createEffect(() => {
		const threads = visibleThreads();
		if (cursorToRestore === null || !threads.length) return;
		// the removed row's slot opened — land on the thread above it
		const i = Math.min(cursorToRestore, threads.length - 1);
		cursorToRestore = null;
		const t = threads[i];
		if (t) void loadThread(t, i);
	});

	createEffect(() => {
		// OAuth callback lands here with ?connected=1 — strip it so a later
		// manual ?connected doesn't retrigger
		if (searchParams.connected) window.location.replace("/admin/email");
	});

	// getInboxQuery syncs in the background (fire-and-forget) so this page must
	// poll until the rows land — otherwise a fresh connect renders an empty inbox
	// that stays empty until the next manual action. Also polls email-status:
	// the background sync writes lastSyncAt only when it finishes, so "never"
	// has to keep revalidating until the timestamp lands.
	onMount(() => {
		let ticks = 0;
		const timer = setInterval(() => {
			const snap = inbox();
			const st = status();
			const waitingFirstSync = snap?.connected && snap.threads.length === 0 && folder() === "inbox";
			const waitingStamp = st?.email && !st.lastSyncAt;
			if ((waitingFirstSync || waitingStamp) && ticks++ < 60) {
				void revalidate("email-inbox");
				void revalidate("email-status");
			} else {
				clearInterval(timer);
			}
		}, 2500);
		onCleanup(() => clearInterval(timer));
	});

	return (
		<Layout>
			<Title>Email — Mad Cactus</Title>
			<div style={{ display: "flex", "align-items": "baseline", gap: "16px" }}>
				<h1 class="page-title">Email</h1>
				<span class="muted" style={{ "font-size": "13px" }}>
					<Show when={status()} fallback="not connected">
						{status()!.email} · last sync {status()!.lastSyncAt ? new Date(status()!.lastSyncAt!).toLocaleTimeString() : "never"}
					</Show>
				</span>
				<div style={{ flex: 1 }} />
				<Show when={sendStatus()}><span class="muted" style={{ "font-size": "13px" }}>{sendStatus()}</span></Show>
				<Show when={!status()} fallback={<button type="button" class="btn btn-sm" onClick={() => sync()}>Sync</button>}>
					<a class="btn btn-sm" aria-busy={connecting()} href="/api/email/oauth" onClick={() => setConnecting(true)}>
						{connecting() ? "Connecting…" : "Connect Gmail"}
					</a>
				</Show>
			</div>
			<p class="page-subtitle">
				j/k move · h/l tabs · V select · e done · u unread · r reply · f forward · ! spam · # delete · x unsub · c compose · / search
			</p>

			<Show when={searchParams.connect}>
				<div
					class="card"
					style={{ padding: "10px 16px", "margin-bottom": "12px", border: "1px solid rgba(180,60,50,0.5)", background: "rgba(180,60,50,0.06)", "font-size": "14px" }}
				>
					Gmail connect failed: {String(searchParams.connect).replace(/^failed:/, "")}
				</div>
			</Show>

			{/* folder tabs */}
			<div style={{ display: "flex", gap: "12px", "align-items": "center" }}>
				<div class="folder-tabs" style={{ "margin-bottom": 0 }}>
					<button type="button" classList={{ active: folder() === "inbox" }} onClick={() => setFolder("inbox")}>
						Inbox<Show when={visibleThreads().length}> · {visibleThreads().length}</Show>
					</button>
					<button type="button" classList={{ active: folder() === "drafts" }} onClick={() => setFolder("drafts")}>
						Drafts<Show when={inbox()?.drafts?.length}> · {inbox()!.drafts.length}</Show>
					</button>
					<button type="button" classList={{ active: folder() === "outbox" }} onClick={() => setFolder("outbox")}>
						Outbox<Show when={inbox()?.outbox?.length}> · {inbox()!.outbox.length}</Show>
					</button>
					<button type="button" classList={{ active: folder() === "sent" }} onClick={() => setFolder("sent")}>
						Sent
					</button>
				</div>
				<button type="button" class="btn btn-sm" onClick={() => setCompose({ to: "", subject: "", body: "" })}>
					Compose (c)
				</button>
			</div>

			{/* Drafts tab — agent + composed drafts, edit → send; every edit
			    lands as a CRDT-tracked version (History shows what changed) */}
			<Show when={folder() === "drafts"}>
				<Show when={inbox()?.drafts?.length} fallback={<div class="muted">No open drafts. Agents push drafts via create_email_draft; compose with c in the Inbox.</div>}>
					<For each={inbox()!.drafts}>
						{(d) => (
							<div
								class="card"
								style={{
									padding: "12px 16px",
									"margin-bottom": "8px",
									cursor: "pointer",
									background: openDraft() === d.id ? "rgba(188, 156, 92, 0.12)" : undefined,
									transition: "background 120ms",
								}}
								onClick={() => setOpenDraft(d.id)}
							>
								<div style={{ display: "flex", gap: "10px", "align-items": "baseline" }}>
									<strong style={{ "font-size": "14px", flex: 1 }}>{editMeta()[d.id]?.subject ?? d.subject}</strong>
									<span class="muted" style={{ "font-size": "12px" }}>to {editMeta()[d.id]?.to ?? d.toEmail} · v{d.version}</span>
								</div>
								<div class="muted" style={{ "font-size": "13px", "margin-top": "4px" }}>
									<Show when={d.status === "failed"}><span style={{ color: "#a33" }}>send failed: {d.error} · </span></Show>
									<Show when={d.sendAt}>fires {new Date(d.sendAt!).toLocaleString()} · </Show>
									{(editBody()[d.id] ?? d.body)?.slice(0, 90)}
								</div>
							</div>
						)}
					</For>
				</Show>
			</Show>

			<Show when={folder() === "outbox"}>
				{/* Outbox — scheduled sends; the scheduler ticker fires these at send_at.
				    Failed sends stay here with their error until retried or discarded */}
				<Show when={inbox()?.outbox?.length} fallback={<div class="muted">Nothing queued. Schedule a draft from the Drafts tab.</div>}>
					<For each={inbox()!.outbox}>
						{(d) => (
							<div class="card" style={{ padding: "14px 18px", "margin-bottom": "10px" }}>
								<div style={{ display: "flex", gap: "12px", "align-items": "baseline" }}>
									<strong style={{ "font-size": "14px" }}>{d.subject}</strong>
									<span class="muted" style={{ "font-size": "13px" }}>to {d.toEmail}</span>
									<Show when={d.status === "failed"}>
										<span style={{ "font-size": "12px", color: "#a33" }}>failed: {d.error}</span>
									</Show>
									<Show when={d.status === "sending"}>
										<span class="muted" style={{ "font-size": "12px" }}>sending…</span>
									</Show>
									<div style={{ flex: 1 }} />
									<button type="button" class="btn btn-sm" onClick={() => sendDraft(d.id)}>Send now</button>
									<button type="button" class="btn btn-sm" onClick={() => void unscheduleDraft(d.id)}>Unschedule</button>
									<button type="button" class="btn btn-sm" onClick={() => discardDraft(d.id)}>Discard</button>
								</div>
								<div class="muted" style={{ "font-size": "13px", "margin-top": "4px" }}>
									<Show when={d.status === "failed"} fallback={<>fires {new Date(d.sendAt!).toLocaleString()}</>}>
										was scheduled for {new Date(d.sendAt!).toLocaleString()}
									</Show>
								</div>
							</div>
						)}
					</For>
				</Show>
			</Show>

			<Show when={folder() !== "drafts"}>
			{/* search */}
			<div style={{ margin: "12px 0", display: "flex", gap: "8px" }}>
				<input
					ref={searchEl}
					type="text"
					placeholder={`Search ${folder()} (/)…`}
					value={q()}
					onInput={(e) => setQ(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") setSearchParams({ q: q() || undefined });
						if (e.key === "Escape") {
							setQ("");
							setSearchParams({ q: undefined });
						}
					}}
					style={{ flex: 1, padding: "10px 14px", background: "var(--bg-card)", border: "1px solid rgba(0,0,0,0.12)", "font-size": "14px" }}
				/>
				<Show when={q() || activeQ()}>
					<button
						type="button"
						class="btn btn-sm"
						onClick={() => {
							setQ("");
							setSearchParams({ q: undefined });
						}}
					>
						Clear
					</button>
				</Show>
			</div>

			<div style={{ display: "grid", "grid-template-columns": selected() ? "1fr 1.4fr" : "1fr", gap: "16px" }}>
				{/* list */}
				<div>
					<Show when={folder() === "inbox"}>
					<Show when={visMode()}>
						<div class="muted" style={{ "font-size": "13px", "margin-bottom": "8px", color: "#bc9c5c" }}>
							visual — {visRangeIds().length} selected · j/k extend · e done · u unread · ! spam · # delete · esc cancel
						</div>
					</Show>
					<Show when={visibleThreads().length} fallback={<div class="muted">{inbox()?.connected ? (searchParams.q ? "No matches." : "Inbox zero.") : "Connect Gmail to load your inbox."}</div>}>
						<For each={visibleThreads().slice(0, visibleCount())}>
							{(t, i) => (
								<div
									data-thread-row=""
									class="card"
									style={{
										padding: "12px 16px",
										"margin-bottom": "8px",
										cursor: "pointer",
										opacity: isUnread(t) ? 1 : 0.75,
										// selected-row tint matches the palette's selection color;
										// rows inside the visual range get a stronger wash
										background:
											visMode() && i() >= visRangeIdx()[0] && i() <= visRangeIdx()[1]
												? "rgba(188, 156, 92, 0.22)"
												: selected()?.thread.id === t.id
													? "rgba(188, 156, 92, 0.12)"
													: undefined,
										transition: "background 120ms",
									}}
									onClick={() => loadThread(t, i())}
									onpointerover={() => prefetch(t)}
								>
									<div style={{ display: "flex", gap: "10px", "align-items": "baseline" }}>
										<Show when={isUnread(t)}><span style={{ color: "#bc9c5c" }}>●</span></Show>
										<strong style={{ "font-size": "14px", flex: 1 }}>{t.subject}</strong>
										<span class="muted" style={{ "font-size": "12px" }}>{new Date(t.lastMessageAt).toLocaleDateString()}</span>
									</div>
									<div class="muted" style={{ "font-size": "13px", "margin-top": "4px" }}>
										{t.fromName} — {t.snippet?.slice(0, 90)}
									</div>
								</div>
							)}
						</For>
						<Show when={visibleThreads().length > visibleCount()}>
							<button type="button" class="btn btn-sm" style={{ "margin-top": "8px" }} onClick={() => setVisibleCount((c) => c + 100)}>
								Load older mail ({visibleThreads().length - visibleCount()} more)…
							</button>
						</Show>
					</Show>
					</Show>
					<Show when={folder() === "sent"}>
					{/* Sent — every thread with mail I sent (dashboard sends land here
					    via the local insert + SENT sync; Gmail-UI sends on next sync) */}
					<Show when={inbox()?.sent?.length} fallback={<div class="muted">Nothing sent yet.</div>}>
						<For each={inbox()!.sent.slice(0, visibleCount())}>
							{(s, i) => (
								<div
									data-thread-row=""
									class="card"
									style={{
										padding: "12px 16px",
										"margin-bottom": "8px",
										cursor: "pointer",
										opacity: 0.85,
										background: selected()?.thread.id === s.thread.id ? "rgba(188, 156, 92, 0.12)" : undefined,
									}}
									onClick={() => loadThread(s.thread, i())}
								>
									<div style={{ display: "flex", gap: "10px", "align-items": "baseline" }}>
										<strong style={{ "font-size": "14px", flex: 1 }}>{s.thread.subject}</strong>
										<span class="muted" style={{ "font-size": "12px" }}>{new Date(s.sentAt).toLocaleDateString()}</span>
									</div>
									<div class="muted" style={{ "font-size": "13px", "margin-top": "4px" }}>
										to {s.to ?? "(unknown)"} — {s.thread.snippet?.slice(0, 90)}
									</div>
								</div>
							)}
						</For>
						<Show when={inbox()!.sent.length > visibleCount()}>
							<button type="button" class="btn btn-sm" style={{ "margin-top": "4px" }} onClick={() => setVisibleCount((c) => c + 100)}>
								Load older sent mail ({inbox()!.sent.length - visibleCount()} more)…
							</button>
						</Show>
					</Show>
					</Show>
				</div>

				{/* reading pane */}
				<Show when={selected()}>
					<div class="card" style={{ padding: "20px 24px" }}>
						<h2 style={{ "font-size": "18px", margin: "0 0 4px" }}>{selected()!.thread.subject}</h2>
						<div class="muted" style={{ "font-size": "13px", "margin-bottom": "12px" }}>{selected()!.thread.fromEmail}</div>
						<For each={selected()!.messages}>
							{(m, i) => {
								// newest message open, everything before it one line — click to expand
								const isLast = i() === selected()!.messages.length - 1;
								if (isLast || openMsg() === i()) {
									return (
										<div style={{ "margin-bottom": "16px", "padding-bottom": "16px", "border-bottom": "1px solid rgba(0,0,0,0.08)" }}>
											<div class="muted" style={{ "font-size": "12px", "margin-bottom": "6px" }}>
												{m.fromName ?? m.fromEmail} · {new Date(m.date).toLocaleString()}
											</div>
											<pre style={{ "white-space": "pre-wrap", "font-family": "inherit", "font-size": "14px", margin: 0 }}>{m.bodyText}</pre>
										</div>
									);
								}
								return (
									<div
										class="muted"
										style={{ "font-size": "13px", cursor: "pointer", "margin-bottom": "8px", "padding-bottom": "8px", "border-bottom": "1px solid rgba(0,0,0,0.08)" }}
										onClick={() => setOpenMsg(i())}
									>
										{m.fromName ?? m.fromEmail} · {new Date(m.date).toLocaleString()} — {m.bodyText?.slice(0, 80)}…
									</div>
								);
							}}
						</For>
						<div style={{ display: "flex", gap: "8px", "margin-top": "8px" }}>
							<button type="button" class="btn btn-sm" onClick={() => threadOp(selected()!.thread.id, "archive")}>Done (e)</button>
							<button type="button" class="btn btn-sm" onClick={() => threadOp(selected()!.thread.id, "unread")}>Unread (u)</button>
							<button type="button" class="btn btn-sm" onClick={askUnsub}>Unsub (x)</button>
							<button type="button" class="btn btn-sm" style={{ "border-color": "#a33", color: "#a33" }} onClick={askSpam}>Spam (!)</button>
							<button type="button" class="btn btn-sm" style={{ "border-color": "#a33", color: "#a33" }} onClick={askDelete}>Delete (#)</button>
						</div>
					</div>
				</Show>
			</div>
			</Show>

			{/* destructive-action confirm modal (spam / delete / unsubscribe) */}
			<Show when={pending()}>
				<div
					style={{ position: "fixed", inset: "0", background: "rgba(0, 0, 0, 0.35)", "z-index": 60, display: "grid", "place-items": "center" }}
					onClick={() => setPending(null)}
				>
					<div class="card" style={{ width: "460px", "max-width": "90vw", padding: "24px", background: "var(--bg-card)", "border-top-color": pending()!.danger ? "#a33" : "var(--text)" }} onClick={(e) => e.stopPropagation()}>
						<h2 style={{ "font-size": "17px", margin: "0 0 8px" }}>{pending()!.title}</h2>
						<p class="muted" style={{ "font-size": "14px", "line-height": "1.5", margin: 0, "overflow-wrap": "anywhere" }}>{pending()!.body}</p>
						<div style={{ display: "flex", gap: "8px", "justify-content": "flex-end", "margin-top": "16px" }}>
							<button type="button" class="btn btn-sm" onClick={() => setPending(null)}>Cancel (esc)</button>
							<button
								type="button"
								class="btn btn-sm"
								style={pending()!.danger ? { "border-color": "#a33", color: "#a33" } : { "border-color": "var(--gold)", color: "var(--gold)" }}
								onClick={() => void confirmPending()}
							>
								{pending()!.confirm} (⏎)
							</button>
						</div>
					</div>
				</div>
			</Show>

			{/* draft editor overlay — click a Drafts row; every field autosaves
			    (body CRDT-tracked → History shows what changed), send/schedule
			    stay lint-gated */}
			<Show when={inbox()?.drafts.find((d) => d.id === openDraft())} keyed>
				{(d) => (
					<div
						class="card"
						style={{ position: "fixed", bottom: "24px", right: "24px", width: "560px", "max-width": "90vw", "max-height": "80vh", "overflow-y": "auto", "z-index": 50 }}
					>
						<div style={{ padding: "16px 20px" }}>
							<input
								placeholder="To"
								value={editMeta()[d.id]?.to ?? d.toEmail}
								onInput={(e) => editDraft(d.id, { to: e.currentTarget.value })}
								style={{ width: "100%", "margin-bottom": "8px", padding: "8px", border: "1px solid rgba(0,0,0,0.12)" }}
							/>
							<input
								placeholder="Subject"
								value={editMeta()[d.id]?.subject ?? d.subject}
								onInput={(e) => editDraft(d.id, { subject: e.currentTarget.value })}
								style={{ width: "100%", "margin-bottom": "8px", padding: "8px", border: "1px solid rgba(0,0,0,0.12)" }}
							/>
							<textarea
								placeholder="Body"
								value={editBody()[d.id] ?? d.body}
								onInput={(e) => editDraft(d.id, { body: e.currentTarget.value })}
								rows={12}
								style={{ width: "100%", "margin-bottom": "8px", padding: "8px", "font-family": "inherit", border: "1px solid rgba(0,0,0,0.12)" }}
							/>
							<div style={{ display: "flex", gap: "8px", "align-items": "center", "flex-wrap": "wrap" }}>
								<button type="button" class="btn btn-sm" classList={{ active: openDraftHistory() === d.id }} onClick={() => void toggleDraftHistory(d.id)}>
									History
								</button>
								<Show when={lintBlockedDraft() === d.id} fallback={<button type="button" class="btn btn-primary btn-sm" onClick={() => sendDraft(d.id)}>Send</button>}>
									<button type="button" class="btn btn-sm" style={{ "border-color": "#a33", color: "#a33" }} onClick={() => sendDraft(d.id, true)}>Send anyway (ignores voice lint)</button>
								</Show>
								<Show
									when={lintBlockedSched() === d.id}
									fallback={
										<Show
											when={!d.sendAt}
											fallback={
												<>
													<span class="muted" style={{ "font-size": "12px" }}>Scheduled {new Date(d.sendAt!).toLocaleString()}</span>
													<button type="button" class="btn btn-sm" onClick={() => void unscheduleDraft(d.id)}>Unschedule</button>
												</>
											}
										>
											<input
												type="datetime-local"
												class="doc-sched-input"
												aria-label="Send at"
												value={schedInput()[d.id] ?? ""}
												onChange={(e) => setSchedInput({ ...schedInput(), [d.id]: e.currentTarget.value })}
											/>
											<button type="button" class="btn btn-sm" onClick={() => void scheduleDraft(d.id)}>Schedule</button>
										</Show>
									}
								>
									<button type="button" class="btn btn-sm" style={{ "border-color": "#a33", color: "#a33" }} onClick={() => void scheduleDraft(d.id, true)}>Schedule anyway (ignores voice lint)</button>
								</Show>
								<button type="button" class="btn btn-sm" onClick={() => discardDraft(d.id)}>Discard</button>
								<div style={{ flex: 1 }} />
								<button type="button" class="btn btn-sm" onClick={() => setOpenDraft(null)}>Close (esc)</button>
							</div>
							<Show when={openDraftHistory() === d.id}>
								<div class="doc-history" style={{ position: "static", width: "100%", "max-height": "160px", "margin-top": "12px" }}>
									<Show when={draftVersions()[d.id]?.length} fallback={<p class="muted">No tracked versions yet.</p>}>
										<For each={draftVersions()[d.id]}>
											{(v) => (
												<button type="button" class="doc-history-row" onClick={() => void showDraftDiff(d.id, v.version)}>
													<span class="doc-history-ver">v{v.version}</span>
													<span class="doc-history-author" classList={{ agent: v.author === "agent" }}>{v.author}</span>
													<span class="muted">{new Date(v.updatedAt).toLocaleString()}</span>
												</button>
											)}
										</For>
										<Show when={draftDiff()?.id === d.id}>
											<div class="doc-diff">
												<Show when={draftDiff()?.parts} fallback={<p class="muted">Loading…</p>}>
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
									</Show>
								</div>
							</Show>
						</div>
					</div>
				)}
			</Show>

			{/* compose/reply overlay */}
			<Show when={compose()}>
				<div style={{ position: "fixed", bottom: "24px", right: "24px", width: "480px", "z-index": 50 }} class="card">
					<div style={{ padding: "16px 20px" }}>
						<input
							placeholder="To"
							value={compose()!.to}
							onInput={(e) => setCompose({ ...compose()!, to: e.currentTarget.value })}
							style={{ width: "100%", "margin-bottom": "8px", padding: "8px", border: "1px solid rgba(0,0,0,0.12)" }}
						/>
						<input
							placeholder="Subject"
							value={compose()!.subject}
							onInput={(e) => setCompose({ ...compose()!, subject: e.currentTarget.value })}
							style={{ width: "100%", "margin-bottom": "8px", padding: "8px", border: "1px solid rgba(0,0,0,0.12)" }}
						/>
						<textarea
							placeholder="Body"
							value={compose()!.body}
							onInput={(e) => setCompose({ ...compose()!, body: e.currentTarget.value })}
							rows={10}
							style={{ width: "100%", "margin-bottom": "8px", padding: "8px", "font-family": "inherit", border: "1px solid rgba(0,0,0,0.12)" }}
						/>
						<div style={{ display: "flex", gap: "8px", "justify-content": "flex-end" }}>
							<button type="button" class="btn btn-sm" onClick={() => setCompose(null)}>Esc</button>
							<button type="button" class="btn btn-primary btn-sm" onClick={manualCompose}>Save draft</button>
						</div>
					</div>
				</div>
			</Show>
		</Layout>
	);
}
