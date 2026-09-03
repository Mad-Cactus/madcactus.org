import { Title } from "@solidjs/meta";
import { createAsync, useAction } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
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
import { OUTREACH_STAGES, type OutreachProspect } from "~/db/schema";

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

function ProspectCard(props: { prospect: OutreachProspect }) {
	const p = () => props.prospect;
	const setStage = useAction(setOutreachStageAction);
	const setNextAction = useAction(setOutreachNextActionAction);
	const [editing, setEditing] = createSignal(false);
	const [error, setError] = createSignal("");

	async function handleStage(stage: string) {
		setError("");
		const fd = new FormData();
		fd.set("id", p().id);
		fd.set("stage", stage);
		const res = (await setStage(fd)) as { error?: string };
		if (res.error) setError(res.error);
	}

	async function handleNextAction(e: Event) {
		e.preventDefault();
		setError("");
		const res = (await setNextAction(withInstantIso(new FormData(e.target as HTMLFormElement)))) as { error?: string };
		if (res.error) {
			setError(res.error);
			return;
		}
		setEditing(false);
	}

	const otherStages = OUTREACH_STAGES.filter((s) => s !== p().stage);

	return (
		<div class="card" style={{ padding: "14px 20px" }}>
			<div style={{ display: "flex", "align-items": "baseline", gap: "10px", "flex-wrap": "wrap" }}>
				<span style={{ "font-weight": "600", "font-size": "14px" }}>{p().company}</span>
				<Show when={p().contactName}>
					<span class="muted" style={{ "font-size": "13px" }}>{p().contactName}</span>
				</Show>
				<Show when={p().email}>
					<a href={`mailto:${p().email}`} class="muted" style={{ "font-size": "12px" }}>{p().email}</a>
				</Show>
				<span class="badge" style={{ color: STAGE_COLOR[p().stage], "margin-left": "auto" }}>{p().stage}</span>
			</div>

			<div class="muted" style={{ "font-size": "12px", margin: "6px 0" }}>
				Next action: {fmtDate(p().nextActionAt)}
				<Show when={p().nextActionNote}> — {p().nextActionNote}</Show>
			</div>

			<Show when={p().videoUrl || p().brainUrl}>
				<div style={{ "font-size": "12px", margin: "6px 0" }}>
					<Show when={p().videoUrl}>
						<a href={p().videoUrl!} target="_blank" rel="noreferrer">video ↗</a>{" "}
						<button
							type="button"
							class="btn btn-sm"
							onClick={() => navigator.clipboard.writeText(`${location.origin}/v/${p().id}`)}
						>
							copy email link
						</button>{" "}
						<Show when={p().videoViewCount > 0} fallback={<span class="muted">unopened</span>}>
							<span style={{ color: "var(--orange)" }}>
								viewed {p().videoViewCount}x
								<Show when={p().videoWatchSeconds > 0}> · {fmtDur(p().videoWatchSeconds)} watched</Show> · last{" "}
								{fmtDate(p().videoLastViewedAt)}
							</span>
						</Show>
					</Show>
					<Show when={p().videoUrl && p().brainUrl}> · </Show>
					<Show when={p().brainUrl}>
						<a href={p().brainUrl!} target="_blank" rel="noreferrer">brain ↗</a>
					</Show>
				</div>
			</Show>

			<Show when={p().brainUrl}>
				<DigestSection brainUrl={p().brainUrl!} />
			</Show>

			<Show when={p().notes}>
				<p class="muted" style={{ "font-size": "12px", margin: "6px 0" }}>{p().notes}</p>
			</Show>

			<div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap", "margin-top": "10px", "align-items": "center" }}>
				<For each={otherStages}>
					{(s) => (
						<button
							type="button"
							class="btn btn-sm"
							style={{ color: STAGE_COLOR[s], "border-color": STAGE_COLOR[s] }}
							onClick={() => handleStage(s)}
						>
							→ {s}
						</button>
					)}
				</For>
				<button type="button" class="btn btn-sm" onClick={() => setEditing(!editing())}>
					{editing() ? "Cancel" : "Edit next action"}
				</button>
			</div>

			<Show when={error()}>
				<p class="login-error">{error()}</p>
			</Show>

			<Show when={editing()}>
				<form onSubmit={handleNextAction} style={{ display: "flex", gap: "8px", "margin-top": "10px", "flex-wrap": "wrap" }}>
					<input type="hidden" name="id" value={p().id} />
					<input type="datetime-local" name="next_action_at" value={toInputValue(p().nextActionAt)} />
					<input
						type="text"
						name="next_action_note"
						placeholder="Next action note"
						value={p().nextActionNote ?? ""}
						style={{ flex: "1", "min-width": "180px" }}
					/>
					<button type="submit" class="btn btn-primary btn-sm">Save</button>
				</form>
			</Show>
		</div>
	);
}

export default function AdminOutreach() {
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const outreach = createAsync(() => getOutreachQuery(), { deferStream: true });
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
			<p class="page-subtitle">Manual follow-ups for company-brain outreach. No email is sent from here.</p>

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

			<Suspense fallback={<p class="muted">Loading…</p>}>
				<h2 style={{ "font-size": "16px" }}>Due now</h2>
				<Show
					when={outreach()?.due.length}
					fallback={<p class="muted">Nothing due — every prospect has a future next action (or is closed).</p>}
				>
					<div style={{ display: "flex", "flex-direction": "column", gap: "10px", "margin-bottom": "28px" }}>
						<For each={outreach()!.due}>{(p) => <ProspectCard prospect={p} />}</For>
					</div>
				</Show>

				<h2 style={{ "font-size": "16px" }}>All prospects</h2>
				<Show
					when={outreach()?.all.length}
					fallback={<p class="muted">No prospects yet.</p>}
				>
					<div style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
						<For each={outreach()!.all}>{(p) => <ProspectCard prospect={p} />}</For>
					</div>
				</Show>
			</Suspense>
		</Layout>
	);
}
