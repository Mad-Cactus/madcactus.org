import { Title } from "@solidjs/meta";
import { createAsync, useAction, useSearchParams } from "@solidjs/router";
import { For, Show, createSignal, createEffect, onMount, onCleanup } from "solid-js";
import Layout from "~/components/Layout";
import {
	getInboxQuery,
	syncEmailAction,
	getEmailStatusQuery,
} from "~/lib/email-queries";
import type { EmailThread, EmailMessage, EmailOutbox } from "~/db/schema";

// Hotkeys mirror macro: j/k move + open, e archive, shift+e unarchive,
// u unread, r reply, f forward, c compose, / search, Esc close.

type ThreadFull = { thread: EmailThread; messages: EmailMessage[] };

export default function AdminEmail() {
	const status = createAsync(() => getEmailStatusQuery(), { deferStream: true });
	const inbox = createAsync(() => getInboxQuery(), { deferStream: true });
	const sync = useAction(syncEmailAction);
	const [searchParams] = useSearchParams();

	const [q, setQ] = createSignal("");
	const [selected, setSelected] = createSignal<ThreadFull | null>(null);
	const [compose, setCompose] = createSignal<{ to: string; subject: string; body: string; threadId?: string } | null>(null);
	const [editBody, setEditBody] = createSignal<Record<string, string>>({});
	const [sendStatus, setSendStatus] = createSignal("");
	const [connecting, setConnecting] = createSignal(false);

	const loadThread = async (t: EmailThread) => {
		const res = await fetch(`/api/email/threads/${t.id}`);
		const data = (await res.json()) as ThreadFull;
		setSelected(data);
		if (t.unread) {
			await fetch(`/api/email/threads/${t.id}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ op: "read" }),
			});
		}
	};

	const threadOp = async (id: string, op: string) => {
		await fetch(`/api/email/threads/${id}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ op }),
		});
		setSelected(null);
	};

	const sendDraft = async (outboxId: string) => {
		setSendStatus("sending…");
		const res = await fetch(`/api/email/drafts/${outboxId}/send`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ body: editBody()[outboxId] }),
		});
		const r = await res.json();
		if (r.blocked) {
			setSendStatus(`BLOCKED by your voice rules: ${r.violations.map((v: any) => v.rule).join("; ")}`);
			return;
		}
		if (r.ok) {
			setSendStatus(r.pairId ? `sent — lesson pair ${r.pairId.slice(0, 8)} queued` : "sent");
			setTimeout(() => setSendStatus(""), 5000);
		} else {
			setSendStatus(`failed: ${r.error}`);
		}
	};

	const discardDraft = async (outboxId: string) => {
		await fetch(`/api/email/drafts/${outboxId}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ op: "discard" }),
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
		const row = (await res.json()) as EmailOutbox;
		setCompose(null);
		await sendDraft(row.id);
	};

	// ── hotkeys ──
	let listIndex = () => 0;
	let searchEl: HTMLInputElement | undefined;
	onMount(() => {
		const handler = async (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			const typing = ["INPUT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable;
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") return; // palette handles
			if (typing) return;
			const threads = inbox()?.threads ?? [];
			if (e.key === "/") {
				e.preventDefault();
				searchEl?.focus();
				return;
			}
			if (e.key === "Escape") {
				setSelected(null);
				setCompose(null);
				return;
			}
			if (compose()) return;
			if (e.key === "j" || e.key === "ArrowDown") {
				e.preventDefault();
				listIndex = () => Math.min(listIndex() + 1, threads.length - 1);
				const t = threads[listIndex()];
				if (t) await loadThread(t);
			} else if (e.key === "k" || e.key === "ArrowUp") {
				e.preventDefault();
				listIndex = () => Math.max(listIndex() - 1, 0);
				const t = threads[listIndex()];
				if (t) await loadThread(t);
			} else if (e.key === "e" && selected()) {
				await threadOp(selected()!.thread.id, "archive");
			} else if (e.key === "E" && selected()) {
				await threadOp(selected()!.thread.id, "unarchive");
			} else if (e.key === "u" && selected()) {
				await threadOp(selected()!.thread.id, "unread");
				setSelected(null);
			} else if (e.key === "r" && selected()) {
				const last = selected()!.messages.filter((m) => !m.isSent).at(-1);
				setCompose({
					to: last?.fromEmail ?? "",
					subject: selected()!.thread.subject.startsWith("Re:") ? selected()!.thread.subject : `Re: ${selected()!.thread.subject}`,
					body: `\n\n---\nOn ${last ? new Date(last.date).toLocaleString() : ""}, ${last?.fromEmail ?? ""} wrote:\n${(last?.bodyText ?? "").slice(0, 2000)}`,
					threadId: selected()!.thread.id,
				});
			} else if (e.key === "f" && selected()) {
				const last = selected()!.messages.at(-1);
				setCompose({
					to: "",
					subject: selected()!.thread.subject.startsWith("Fwd:") ? selected()!.thread.subject : `Fwd: ${selected()!.thread.subject}`,
					body: `\n\n---\nForwarded message from ${last?.fromEmail ?? ""}:\n${(last?.bodyText ?? "").slice(0, 2000)}`,
				});
			} else if (e.key === "c") {
				setCompose({ to: "", subject: "", body: "" });
			}
		};
		window.addEventListener("keydown", handler);
		onCleanup(() => window.removeEventListener("keydown", handler));
	});

	createEffect(() => {
		// OAuth callback lands here with ?connected=1 — strip it so a later
		// manual ?connected doesn't retrigger
		if (searchParams.connected) window.location.replace("/admin/email");
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
				j/k move · e done · u unread · r reply · f forward · c compose · / search — agent drafts below are
				voice-linted before sending
			</p>

			<Show when={searchParams.connect}>
				<div
					class="card"
					style={{ padding: "10px 16px", "margin-bottom": "12px", border: "1px solid rgba(180,60,50,0.5)", background: "rgba(180,60,50,0.06)", "font-size": "14px" }}
				>
					Gmail connect failed: {String(searchParams.connect).replace(/^failed:/, "")}
				</div>
			</Show>

			{/* Agent outbox drafts */}
			<Show when={inbox()?.drafts?.length}>
				<h2 style={{ "font-size": "16px", margin: "16px 0 8px" }}>Agent drafts</h2>
				<For each={inbox()!.drafts}>
					{(d) => (
						<div class="card" style={{ padding: "16px 20px", "margin-bottom": "10px", border: "1px solid rgba(188,156,92,0.5)" }}>
							<div style={{ display: "flex", gap: "12px", "align-items": "baseline" }}>
								<strong style={{ "font-size": "14px" }}>{d.subject}</strong>
								<span class="muted" style={{ "font-size": "13px" }}>to {d.toEmail}</span>
								<div style={{ flex: 1 }} />
								<button type="button" class="btn btn-primary btn-sm" onClick={() => sendDraft(d.id)}>Send</button>
								<button type="button" class="btn btn-sm" onClick={() => discardDraft(d.id)}>Discard</button>
							</div>
							<textarea
								value={editBody()[d.id] ?? d.body}
								onInput={(e) => setEditBody({ ...editBody(), [d.id]: e.currentTarget.value })}
								rows={6}
								style={{ width: "100%", "margin-top": "10px", "font-family": "inherit", "font-size": "14px" }}
							/>
						</div>
					)}
				</For>
			</Show>

			{/* search */}
			<div style={{ margin: "12px 0" }}>
				<input
					ref={searchEl}
					type="text"
					placeholder="Search mail (/)…"
					value={q()}
					onInput={(e) => setQ(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") window.location.href = `/admin/email?q=${encodeURIComponent(q())}`;
					}}
					style={{ width: "100%", padding: "10px 14px", background: "var(--bg-card)", border: "1px solid rgba(0,0,0,0.12)", "font-size": "14px" }}
				/>
			</div>

			<div style={{ display: "grid", "grid-template-columns": selected() ? "1fr 1.4fr" : "1fr", gap: "16px" }}>
				{/* list */}
				<div>
					<Show when={inbox()?.threads?.length} fallback={<div class="muted">{inbox()?.connected ? "Inbox zero." : "Connect Gmail to load your inbox."}</div>}>
						<For each={inbox()?.threads}>
							{(t) => (
								<div
									class="card"
									style={{ padding: "12px 16px", "margin-bottom": "8px", cursor: "pointer", opacity: t.unread ? 1 : 0.75 }}
									onClick={() => loadThread(t)}
								>
									<div style={{ display: "flex", gap: "10px", "align-items": "baseline" }}>
										<Show when={t.unread}><span style={{ color: "#bc9c5c" }}>●</span></Show>
										<strong style={{ "font-size": "14px", flex: 1 }}>{t.subject}</strong>
										<span class="muted" style={{ "font-size": "12px" }}>{new Date(t.lastMessageAt).toLocaleDateString()}</span>
									</div>
									<div class="muted" style={{ "font-size": "13px", "margin-top": "4px" }}>
										{t.fromName} — {t.snippet?.slice(0, 90)}
									</div>
								</div>
							)}
						</For>
					</Show>
				</div>

				{/* reading pane */}
				<Show when={selected()}>
					<div class="card" style={{ padding: "20px 24px" }}>
						<h2 style={{ "font-size": "18px", margin: "0 0 4px" }}>{selected()!.thread.subject}</h2>
						<div class="muted" style={{ "font-size": "13px", "margin-bottom": "12px" }}>{selected()!.thread.fromEmail}</div>
						<For each={selected()!.messages}>
							{(m) => (
								<div style={{ "margin-bottom": "16px", "padding-bottom": "16px", "border-bottom": "1px solid rgba(0,0,0,0.08)" }}>
									<div class="muted" style={{ "font-size": "12px", "margin-bottom": "6px" }}>
										{m.fromName ?? m.fromEmail} · {new Date(m.date).toLocaleString()}
									</div>
									<pre style={{ "white-space": "pre-wrap", "font-family": "inherit", "font-size": "14px", margin: 0 }}>{m.bodyText}</pre>
								</div>
							)}
						</For>
						<div style={{ display: "flex", gap: "8px", "margin-top": "8px" }}>
							<button type="button" class="btn btn-sm" onClick={() => threadOp(selected()!.thread.id, "archive")}>Done (e)</button>
							<button type="button" class="btn btn-sm" onClick={() => threadOp(selected()!.thread.id, "unread")}>Unread (u)</button>
						</div>
					</div>
				</Show>
			</div>

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
							<button type="button" class="btn btn-primary btn-sm" onClick={manualCompose}>Send</button>
						</div>
					</div>
				</div>
			</Show>
		</Layout>
	);
}
