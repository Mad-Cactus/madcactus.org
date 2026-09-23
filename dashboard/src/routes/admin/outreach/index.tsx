import { Title } from "@solidjs/meta";
import { createAsync, useAction, useNavigate } from "@solidjs/router";
import { For, Show, Suspense, createSignal, createMemo } from "solid-js";
import Layout from "~/components/Layout";
import { getUserQuery } from "~/lib/queries";
import {
	getOutreachQuery,
	createOutreachAction,
	setOutreachStageAction,
	setOutreachIcpAction,
	setOutreachNextActionAction,
	setOutreachBrainAction,
	setOutreachVideoAction,
	getBrainDigestQuery,
	getBrainActivityQuery,
	setOutreachContactAction,
	resetBrainActivityAction,
	getProspectEmailCardQuery,
	setProspectCampaignAction,
	type BrainActivity,
	type BrainDigestItem,
} from "~/lib/admin-queries";
import { OUTREACH_STAGES, stageLabel, type OutreachProspect, type OutreachStage } from "~/db/schema";
import type { ProspectEmailStatus } from "~/lib/admin-queries";
import { fmtDate, fmtDur, videoSummary } from "~/lib/video-summary";

const STAGE_COLOR: Record<string, string> = {
	candidate: "var(--text-subtle)",
	proposed: "#8e7cc3",
	sent: "var(--text-subtle)",
	watching: "var(--orange)",
	replied: "#2980b9",
	meeting: "#2980b9",
	won: "var(--green)",
	shutdown: "var(--red)",
};


/** The one next stage an advance button moves a card to (with its preset
 *  next-action interval — see STAGE_NEXT_DAYS in admin-queries). */
const ADVANCE: Partial<Record<OutreachStage, { next: OutreachStage; label: string }>> = {
	candidate: { next: "proposed", label: "Invite → +3d" },
	proposed: { next: "sent", label: "Invite sent → +3d" },
	sent: { next: "watching", label: "Followed up → +4d" },
	watching: { next: "replied", label: "Replied → +1d" },
	replied: { next: "meeting", label: "Meeting set → +1d" },
};

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

function ActivityDetails(props: { prospect: OutreachProspect }) {
	const activity = createAsync(() => getBrainActivityQuery(props.prospect.id));
	const reset = useAction(resetBrainActivityAction);
	const [resetMsg, setResetMsg] = createSignal("");
	async function handleReset() {
		if (
			!confirm(
				`Reset ${props.prospect.company} brain metrics? Wipes visits, clicks, scroll, dwell and tool history on the brain. Cannot be undone.`,
			)
		)
			return;
		setResetMsg("");
		const fd = new FormData();
		fd.set("id", props.prospect.id);
		const r = (await reset(fd)) as { error?: string; success?: string };
		setResetMsg(r.error ?? r.success ?? "");
	}
	return (
		<Suspense fallback={<p class="muted" style={{ "font-size": "12px" }}>Loading…</p>}>
			<Show when={activity()}>
				{(a) => (
					<Show
						when={!a().error}
						fallback={
							<p class="muted" style={{ "font-size": "12px", "font-style": "italic" }}>
								{a().error === "no key" ? "no activity key configured for this brain" : "brain unreachable"}
							</p>
						}
					>
						<ActivityMetrics activity={(a() as { activity: BrainActivity }).activity} />
						<ActivityChart days={(a() as { activity: BrainActivity }).activity.days} />
						<div style={{ display: "flex", gap: "8px", "align-items": "center", "margin-top": "6px", "flex-wrap": "wrap" }}>
							<button type="button" class="btn btn-sm" onClick={handleReset}>
								reset metrics
							</button>
							<Show when={resetMsg()}>
								<span class="muted" style={{ "font-size": "12px" }}>{resetMsg()}</span>
							</Show>
						</div>
					</Show>
				)}
			</Show>
		</Suspense>
	);
}

function ActivityChart(props: { days: { dd: string; v: number; t: number }[] }) {
	// brains only report days with activity — fill a 14-slot window ending today
	// so "gaps" read as gaps, not as a shorter chart
	const byDay = new Map(props.days.map((d) => [d.dd, d]));
	const slots = Array.from({ length: 14 }, (_, i) => {
		const dd = new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10);
		return byDay.get(dd) ?? { dd, v: 0, t: 0 };
	});
	const max = Math.max(1, ...slots.map((s) => s.v + s.t));
	return (
		<div>
			<svg
				viewBox="0 0 140 30"
				style={{ width: "100%", height: "34px", display: "block", "margin-top": "4px" }}
				role="img"
				aria-label="visits and agent tool calls per day, last 14 days"
			>
				<For each={slots}>
					{(s, i) => {
						const x = i() * 10;
						const vh = (s.v / max) * 26;
						const th = (s.t / max) * 26;
						return (
							<>
								<rect x={x} y={28 - vh} width={6} height={vh} fill="#2980b9" rx={1} />
								<rect x={x + 6.5} y={28 - th} width={3} height={th} fill="#8e7cc3" rx={1} />
							</>
						);
					}}
				</For>
				<line x1={0} y1={28.5} x2={140} y2={28.5} stroke="rgba(127,127,127,0.35)" stroke-width={1} />
			</svg>
			<div class="muted" style={{ "font-size": "11px" }}>
				last 14 days — <span style={{ color: "#2980b9" }}>▮</span> visits <span style={{ color: "#8e7cc3" }}>▮</span> agent tool calls
			</div>
		</div>
	);
}

function ActivityMetrics(props: { activity: BrainActivity }) {
	const a = () => props.activity;
	return (
		<Show
			when={a().visits > 0 || a().toolCalls > 0}
			fallback={<p class="muted" style={{ "font-size": "12px", "font-style": "italic" }}>no brain activity yet</p>}
		>
			<div class="muted" style={{ "font-size": "12px", margin: "5px 0", display: "grid", gap: "2px" }}>
				<div>
					{a().visits} visit{a().visits === 1 ? "" : "s"}
					<Show when={a().visitDays > 1}> across {a().visitDays} days</Show>
					<Show when={a().lastVisit}> · last {fmtDate(new Date(a().lastVisit!))}</Show>
				</div>
				<div>
					read to {a().maxDepth}% · dwell {a().maxDwell ? fmtDur(a().maxDwell) : "0s"} · {a().clicks} click{a().clicks === 1 ? "" : "s"}
				</div>
				<Show when={a().toolCalls > 0}>
					<div>
						MCP: {a().toolCalls} call{a().toolCalls === 1 ? "" : "s"}
						<Show when={a().lastToolAt}> · last {fmtDate(new Date(a().lastToolAt!))}</Show>
						<Show when={a().tools.length}> — {a().tools.join(", ")}</Show>
					</div>
				</Show>
				<Show when={a().agent}>
					<div>agent: {a().agent}</div>
				</Show>
			</div>
		</Show>
	);
}

/** Opening the brain from here auto-sets the me-cookie (?key=) so Collin's
 * demo visits never pollute prospect tracking — no ritual to forget. */
function brainHref(p: OutreachProspect): string {
	const base = (p.brainUrl ?? "").replace(/\/+$/, "");
	return p.brainActivityKey ? `${base}/?key=${p.brainActivityKey}` : base;
}

/** Email preview card: latest synced thread for the prospect's address,
 *  who-has-the-ball badge, one-click address linking from thread history. */
function EmailSection(props: { prospect: OutreachProspect }) {
	const p = () => props.prospect;
	const data = createAsync(() => getProspectEmailCardQuery(p().id));
	const setContact = useAction(setOutreachContactAction);
	const navigate = useNavigate();
	const [linkMsg, setLinkMsg] = createSignal("");
	async function linkAddress(addr: string) {
		setLinkMsg("");
		const fd = new FormData();
		fd.set("id", p().id);
		fd.set("contact_name", p().contactName ?? "");
		fd.set("email", addr);
		const r = (await setContact(fd)) as { error?: string };
		if (r.error) setLinkMsg(r.error);
	}
	return (
		<Suspense fallback={<p class="muted" style={{ "font-size": "12px" }}>Loading email…</p>}>
			<Show when={data()}>
				{(d) => (
					<div
						title="open in emails tab"
						style={{
							background: "rgba(0, 0, 0, 0.04)",
							"border-radius": "6px",
							padding: "8px",
							margin: "5px 0",
							display: "grid",
							gap: "4px",
							cursor: "pointer",
						}}
						onClick={(e) => {
							// the whole card jumps to the thread; chips/buttons keep their own behavior
							if ((e.target as HTMLElement).closest("a,button")) return;
							navigate(`/admin/email?q=${encodeURIComponent((d() as { email: string }).email)}`);
						}}
					>
						<div style={{ display: "flex", "align-items": "baseline", gap: "6px" }}>
							<span style={{ "font-weight": "600", "font-size": "12px" }}>Email</span>
							<Show
								when={(d() as { card: unknown }).card}
								fallback={<span class="muted" style={{ "font-size": "12px" }}>no synced threads with this address</span>}
							>
								<span
									class="badge"
									style={{
										color: (d() as { card: { replied: boolean } }).card.replied ? "var(--green)" : "var(--text-subtle)",
										"margin-left": "auto",
									}}
								>
									{(d() as { card: { replied: boolean } }).card.replied ? "they replied" : "waiting on them"}
								</span>
							</Show>
						</div>
						<Show when={(d() as { card: { subject: string; lastMessageAt: Date } }).card}>
							{(c) => (
								<>
									<div class="muted" style={{ "font-size": "12px" }}>
										{c().subject} · {fmtDate(c().lastMessageAt)}
									</div>
									<div class="muted" style={{ "font-size": "12px", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
										{((d() as { card: { snippet: string | null } }).card.snippet ?? "").replace(/\s+/g, " ")}
									</div>
								</>
							)}
						</Show>
						<Show when={(d() as { suggestions: { email: string }[] }).suggestions.length}>
							<div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap", "margin-top": "4px" }}>
								<span class="muted" style={{ "font-size": "12px", "align-self": "center" }}>link:</span>
								<For each={(d() as { suggestions: { email: string; lastAt: Date }[] }).suggestions}>
									{(s) => (
										<button type="button" class="btn btn-sm" title={fmtDate(s.lastAt)} onClick={() => linkAddress(s.email)}>
											{s.email}
										</button>
									)}
								</For>
							</div>
						</Show>
						<Show when={linkMsg()}>
							<span class="login-error" style={{ "font-size": "12px" }}>{linkMsg()}</span>
						</Show>
					</div>
				)}
			</Show>
		</Suspense>
	);
}

/** Boxed video block: description + copy email/test buttons + cap link. */
function VideoSection(props: { videoUrl?: string | null; videoId: string; description?: string | null }) {
	return (
		<Show when={props.videoUrl}>
			<div
				style={{
					background: "rgba(0, 0, 0, 0.04)",
					"border-radius": "6px",
					padding: "8px",
					margin: "5px 0",
					display: "grid",
					gap: "6px",
					"justify-items": "start",
				}}
			>
				<div style={{ "font-weight": "600" }}>Video</div>
				<Show when={props.description}>
					<div class="muted">{props.description}</div>
				</Show>
				<button
					type="button"
					class="btn btn-sm"
					onClick={() => navigator.clipboard.writeText(`${location.origin}/v/${props.videoId}`)}
				>
					copy email link
				</button>
				<button
					type="button"
					class="btn btn-sm"
					onClick={() => navigator.clipboard.writeText(`${location.origin}/v/${props.videoId}?test=1`)}
				>
					copy test email link
				</button>
				<a class="btn btn-sm" href={props.videoUrl!} target="_blank" rel="noreferrer">cap ↗</a>
			</div>
		</Show>
	);
}

function BoardCard(props: {
		prospect: OutreachProspect & { emailStatus?: ProspectEmailStatus | null };
		due: boolean;
		overdue?: boolean;
		onDragStart?: (id: string | undefined) => void;
		onHoverStage?: (stage: string | undefined) => void;
		onDrop?: (stage: OutreachStage, id: string) => void;
		campaigns?: { id: string; name: string }[];
	}) {
	const p = () => props.prospect;
	const setStage = useAction(setOutreachStageAction);
	const setIcp = useAction(setOutreachIcpAction);
	const setBrain = useAction(setOutreachBrainAction);
	const setVideo = useAction(setOutreachVideoAction);
	const setNextAction = useAction(setOutreachNextActionAction);
	const setContact = useAction(setOutreachContactAction);
	const setCampaign = useAction(setProspectCampaignAction);
	const [editing, setEditing] = createSignal(false);
	const [error, setError] = createSignal("");
	const [dragging, setDragging] = createSignal(false);
	const [open, setOpen] = createSignal(false);
	let dialogRef!: HTMLDialogElement;

	// pointer-based drag (not HTML5 DnD): native drag is a black box across
	// browsers/touch — link-steal, no auto-scroll, dead zones. With pointer
	// events: <5px move = click (opens dialog), more = drag; drop target is
	// resolved from elementFromPoint, so columns just need a data-stage attr.
	let drag: { startX: number; startY: number; active: boolean } | null = null;
	let cardRef!: HTMLDivElement;

	function stageAt(x: number, y: number): string | undefined {
		const el = document.elementFromPoint(x, y)?.closest?.("[data-stage]") as HTMLElement | null;
		return el?.dataset.stage;
	}

	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		// buttons/inputs keep press semantics; links are allowed — preventDefault
		// stops the browser from dragging the link URL instead of the card
		if ((e.target as HTMLElement).closest("button,input,select,textarea,form,dialog")) return;
		e.preventDefault();
		drag = { startX: e.clientX, startY: e.clientY, active: false };
		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", onPointerUp, { once: true });
		window.addEventListener("pointercancel", onPointerCancel, { once: true });
	}

	function onPointerMove(e: PointerEvent) {
		if (!drag) return;
		if (!drag.active) {
			if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5) return;
			drag.active = true;
			setDragging(true);
			props.onDragStart?.(p().id);
		}
		e.preventDefault();
		props.onHoverStage?.(stageAt(e.clientX, e.clientY));
		// horizontal auto-scroll when the pointer nears the board's edges
		const board = cardRef.closest(".board") as HTMLElement | null;
		if (board) {
			const r = board.getBoundingClientRect();
			if (e.clientX > r.right - 56) board.scrollLeft += 14;
			else if (e.clientX < r.left + 56) board.scrollLeft -= 14;
		}
	}

	function finish() {
		window.removeEventListener("pointermove", onPointerMove);
		setDragging(false);
		drag = null;
		props.onHoverStage?.(undefined);
	}

	function onPointerCancel() {
		if (drag?.active) props.onDragStart?.(undefined);
		finish();
	}

	function onPointerUp(e: PointerEvent) {
		const wasDrag = drag?.active;
		finish();
		if (!wasDrag) {
			// it was a click: links/buttons keep their own behavior
			if (!(e.target as HTMLElement).closest("a,button,input,select,textarea,form")) {
				setOpen(true);
				if (!dialogRef.open) dialogRef.showModal();
			}
			return;
		}
		props.onDragStart?.(undefined);
		const stage = stageAt(e.clientX, e.clientY);
		if (stage && stage !== p().stage) props.onDrop?.(stage as OutreachStage, p().id);
	}

	// advance button: one click to the next stage WITH its next-action preset
	async function advance() {
		const a = ADVANCE[p().stage as OutreachStage];
		if (!a) return;
		setError("");
		const fd = new FormData();
		fd.set("id", p().id);
		fd.set("stage", a.next);
		fd.set("preset_next", "1");
		const r = (await setStage(fd)) as { error?: string };
		if (r.error) setError(r.error);
	}

	// candidate review: the fit gate the connect automation checks
	async function approveIcp() {
		setError("");
		const fd = new FormData();
		fd.set("id", p().id);
		fd.set("icp_approved", p().icpApproved ? "0" : "1");
		const r = (await setIcp(fd)) as { error?: string };
		if (r.error) setError(r.error);
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
		const contactName = String(fd.get("contact_name") || "").trim();
		const email = String(fd.get("email") || "").trim();
		if (contactName !== (p().contactName ?? "") || email !== (p().email ?? "")) {
			const rc = (await setContact(fd)) as { error?: string };
			if (rc.error) {
				setError(rc.error);
				return;
			}
		}
		const brainUrl = String(fd.get("brain_url") || "").trim();
		const brainKey = String(fd.get("brain_activity_key") || "").trim();
		if (brainUrl !== (p().brainUrl ?? "") || brainKey !== (p().brainActivityKey ?? "")) {
			const r2 = (await setBrain(fd)) as { error?: string };
			if (r2.error) {
				setError(r2.error);
				return;
			}
		}
		const videoUrl = String(fd.get("video_url") || "").trim();
		const videoDesc = String(fd.get("video_description") || "").trim();
		if (videoUrl !== (p().videoUrl ?? "") || videoDesc !== (p().videoDescription ?? "")) {
			const r3 = (await setVideo(fd)) as { error?: string };
			if (r3.error) {
				setError(r3.error);
				return;
			}
		}
		const campaignId = String(fd.get("campaign_id") || "").trim();
		if (campaignId !== (p().campaignId ?? "")) {
			const r4 = (await setCampaign(fd)) as { error?: string };
			if (r4.error) {
				setError(r4.error);
				return;
			}
		}
		const icpChanged =
			String(fd.get("region")) !== p().region ||
			String(fd.get("revenue_band")) !== p().revenueBand ||
			String(fd.get("tech_team")) !== p().techTeam ||
			String(fd.get("ai_interest")) !== p().aiInterest ||
			String(fd.get("icp_approved")) !== (p().icpApproved ? "1" : "0");
		if (icpChanged) {
			const r5 = (await setIcp(fd)) as { error?: string };
			if (r5.error) {
				setError(r5.error);
				return;
			}
		}
		setEditing(false);
	}

	return (
		<div
			class="board-card"
			ref={cardRef}
			classList={{ dragging: dragging() }}
			style={{ "border-color": props.overdue ? "var(--red)" : undefined }}
			onPointerDown={onPointerDown}
		>
			<div style={{ display: "flex", "align-items": "baseline", gap: "6px" }}>
				<span style={{ "font-weight": "600", "font-size": "13px" }}>{p().company}</span>
				<Show when={p().icpApproved}>
					<span class="badge" style={{ color: "var(--green)", "white-space": "nowrap" }}>ICP ✓</span>
				</Show>
				<Show when={props.due}>
					<span class="badge" style={{ color: "var(--orange)", "margin-left": "auto", "white-space": "nowrap" }}>due</span>
				</Show>
			</div>
			<Show when={p().stage === "candidate"}>
				<button type="button" class="btn btn-sm" style={{ margin: "4px 0" }} onClick={() => void approveIcp()}>
					{p().icpApproved ? "Un-approve" : "Approve fit"}
				</button>
			</Show>
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

			{/* email status — matched by the prospect's address against the synced
		    corpus; "view" opens the Email tab pre-filtered to that address */}
			<Show when={p().emailStatus?.lastSentAt}>
				<div class="muted" style={{ "font-size": "12px", margin: "5px 0" }}>
					sent {fmtDate(p().emailStatus!.lastSentAt!)}
				</div>
			</Show>


			{/* edit form lives in the detail dialog only — the card stays minimal.
			    stage select covers touch + keyboard — HTML5 drag doesn't fire there */}

			{/* detail dialog: email, brain digest + activity live here, not on the card */}
			<dialog
				class="prospect-modal"
				ref={dialogRef}
				onClick={(e) => e.stopPropagation()}
				onClose={() => setOpen(false)}
			>
				<Show when={open()}>
				<Show when={error()}>
					<p class="login-error">{error()}</p>
				</Show>
					<div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
						<h2 style={{ margin: "0", "font-size": "15px" }}>{p().company}</h2>
						<div style={{ "margin-left": "auto", display: "flex", gap: "6px" }}>
						<Show when={ADVANCE[p().stage as OutreachStage]}>
							<button type="button" class="btn btn-primary btn-sm" onClick={() => void advance()}>
								{ADVANCE[p().stage as OutreachStage]!.label}
							</button>
						</Show>
						<button
							type="button"
							class="btn btn-sm"
							onClick={() => setEditing(!editing())}
						>
							{editing() ? "Close editor" : "Edit"}
						</button>
								<button type="button" class="btn btn-sm" onClick={() => dialogRef.close()}>
									Close
								</button>
							</div>
					</div>
					<Show when={p().contactName || p().email}>
						<p style={{ margin: "10px 0", "font-size": "13px" }}>
							<Show when={p().contactName}>{p().contactName} · </Show>
							<Show when={p().email}>
								<a href={`mailto:${p().email}`}>{p().email}</a>
							</Show>
						</p>
					</Show>
					<Show when={p().email}>
						<EmailSection prospect={p()} />
					</Show>
					<div class="muted" style={{ "font-size": "12px", margin: "8px 0", color: props.due ? "var(--orange)" : undefined }}>
						→ {fmtDate(p().nextActionAt)}
						<Show when={p().nextActionNote}> — {p().nextActionNote}</Show>
					</div>
					<div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap", margin: "12px 0" }}>
						<Show when={p().brainUrl}>
							<a class="btn btn-sm" href={brainHref(p())} target="_blank" rel="noreferrer">brain ↗</a>
						</Show>
						<VideoSection videoUrl={p().videoUrl} videoId={p().id} description={p().videoDescription} />
					</div>
					<Show when={p().brainUrl}>
						<ActivityDetails prospect={p()} />
						<details style={{ "margin-top": "8px" }}>
							<summary class="muted" style={{ cursor: "pointer", "font-size": "12px" }}>What to mention (digest)</summary>
							<DigestSection brainUrl={p().brainUrl!} />
						</details>
					</Show>
					<Show when={p().videoUrl && videoSummary(p())}>
						<div style={{ color: "var(--orange)", "font-size": "12px", margin: "8px 0" }}>{videoSummary(p())}</div>
					</Show>
					<Show when={p().notes}>
						<p class="muted" style={{ "font-size": "12px", margin: "8px 0" }}>{p().notes}</p>
					</Show>
				</Show>
				<Show when={editing()}>
					<form onSubmit={handleSave} style={{ display: "grid", gap: "8px", "margin-top": "12px" }}>
						<input type="hidden" name="id" value={p().id} />
						<input type="text" name="contact_name" placeholder="Contact name" value={p().contactName ?? ""} />
						<input type="email" name="email" placeholder="Email (sent-to address)" value={p().email ?? ""} spellcheck={false} />
						<select name="stage" value={p().stage}>
							<For each={OUTREACH_STAGES}>{(s) => <option value={s}>{stageLabel(s)}</option>}</For>
						</select>
						<input type="datetime-local" name="next_action_at" value={toInputValue(p().nextActionAt)} />
						<input type="url" name="video_url" placeholder="Video URL (cap.so share link)" value={p().videoUrl ?? ""} spellcheck={false} />
						<input type="text" name="video_description" placeholder="Video description (what it shows / why)" value={p().videoDescription ?? ""} />
						<input type="text" name="next_action_note" placeholder="Next action note" value={p().nextActionNote ?? ""} />
						<input type="url" name="brain_url" placeholder="Brain URL (https://….madcactus.org)" value={p().brainUrl ?? ""} spellcheck={false} />
						<input type="text" name="brain_activity_key" placeholder="Brain activity key" value={p().brainActivityKey ?? ""} spellcheck={false} />
						<select name="campaign_id" value={p().campaignId ?? ""}>
							<option value="">— no campaign —</option>
							<For each={props.campaigns ?? []}>{(c) => <option value={c.id}>{c.name}</option>}</For>
						</select>
						{/* ICP fields — researched, never asked of the lead */}
						<div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
							<select name="region" value={p().region}>
								<For each={["unknown", "Midwest", "other"]}>{(v) => <option value={v}>region: {v}</option>}</For>
							</select>
							<select name="revenue_band" value={p().revenueBand}>
								<For each={["unknown", "low", "mid", "high"]}>{(v) => <option value={v}>revenue: {v}</option>}</For>
							</select>
							<select name="tech_team" value={p().techTeam}>
								<For each={["unknown", "none", "small", "large"]}>{(v) => <option value={v}>tech team: {v}</option>}</For>
							</select>
							<select name="ai_interest" value={p().aiInterest}>
								<For each={["unknown", "none", "some", "high"]}>{(v) => <option value={v}>AI interest: {v}</option>}</For>
							</select>
							<select name="icp_approved" value={p().icpApproved ? "1" : "0"}>
								<option value="0">ICP: not approved</option>
								<option value="1">ICP: approved</option>
							</select>
						</div>
						<button type="submit" class="btn btn-primary btn-sm">Save</button>
					</form>
				</Show>
			</dialog>
		</div>
	);
}

function Board() {
	const outreach = createAsync(() => getOutreachQuery(), { deferStream: true });
	const setStage = useAction(setOutreachStageAction);
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

	async function handleDrop(stage: OutreachStage, id: string) {
		setError("");
		setHoverStage(undefined);
		const p = outreach()?.all.find((x) => x.id === id);
		if (!p || p.stage === stage) return;
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

	// overdue = due before today started (red tint in the Today queue)
	const overdueIds = createMemo(() => {
		const start = new Date();
		start.setHours(0, 0, 0, 0);
		return new Set((outreach()?.due ?? []).filter((p) => p.nextActionAt && p.nextActionAt < start).map((p) => p.id));
	});

	return (
		<div>
			<Show when={error()}>
				<p class="login-error">{error()}</p>
			</Show>
			<Suspense fallback={<p class="muted">Loading…</p>}>
				<Show when={outreach()?.all.length} fallback={<p class="muted">No prospects yet — add one above.</p>}>
					{/* pinned Today queue — everything due now, overdue first */}
					<Show when={outreach()?.due.length}>
						<h2 style={{ "font-size": "15px", margin: "20px 0 10px" }}>
							Today <span class="board-col-count">{outreach()?.due.length}</span>
						</h2>
						<div style={{ display: "flex", gap: "10px", "flex-wrap": "wrap", "margin-bottom": "20px" }}>
							<For each={outreach()?.due}>
								{(p) => (
									<div style={{ width: "230px" }}>
										<BoardCard
											prospect={p}
											due={true}
											overdue={overdueIds().has(p.id)}
											onHoverStage={setHoverStage}
											onDrop={handleDrop}
											campaigns={outreach()?.campaigns}
										/>
									</div>
								)}
							</For>
						</div>
					</Show>
					<div class="board">
						<For each={columns()}>
							{(col) => (
								<div
									class="board-col"
										data-stage={col.stage}
									classList={{ "drag-over": hoverStage() === col.stage }}
								>
									<div class="board-col-head">
										<span class="dot" style={{ background: STAGE_COLOR[col.stage] }} />
										{stageLabel(col.stage)}
										<span class="board-col-count">{col.cards.length}</span>
									</div>
									<div class="board-cards">
										<For each={col.cards}>
											{(p) => (
												<BoardCard
													prospect={p}
													due={dueIds().has(p.id)}
													onHoverStage={setHoverStage}
													onDrop={handleDrop}
												campaigns={outreach()?.campaigns}
												/>
											)}
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
						<input type="email" name="email" placeholder="Email" spellcheck={false} />
					</div>
					<div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
						<input type="url" name="brain_url" placeholder="Brain URL (https://…)" spellcheck={false} />
						<input type="text" name="brain_activity_key" placeholder="Brain activity key" spellcheck={false} />
						<input type="url" name="video_url" placeholder="Video URL" spellcheck={false} />
					</div>
					<div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
						<select name="stage">
							<For each={OUTREACH_STAGES}>{(s) => <option value={s}>{stageLabel(s)}</option>}</For>
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
