import { useAction, useLocation, createAsync } from "@solidjs/router";
import { For, Show, createSignal, onCleanup } from "solid-js";
import {
	discardTimerAction,
	getProjectsQuery,
	getTimerQuery,
	startTimerAction,
	stopTimerAction,
} from "~/lib/queries";

function fmtElapsed(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	const mm = String(m).padStart(2, "0");
	const ss = String(sec).padStart(2, "0");
	return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Live start/stop timer, persisted server-side so it survives refresh.
 *
 * keyed: Solid passes the row value itself instead of a guarded accessor.
 * The non-keyed accessor throws "Stale read from <Show>" if the 1s interval
 * effect reads t() while timer() flips during a start/stop revalidation.
 */
export default function Timer() {
	const timer = createAsync(() => getTimerQuery());
	const projects = createAsync(() => getProjectsQuery());
	const start = useAction(startTimerAction);
	const stop = useAction(stopTimerAction);
	const discard = useAction(discardTimerAction);
	const location = useLocation();

	// ponytail: 1s interval re-render for the live readout. Fine for one
	// widget; swap to a web worker if it ever lands in a long list.
	const [now, setNow] = createSignal(Date.now());
	const interval = setInterval(() => setNow(Date.now()), 1000);
	onCleanup(() => clearInterval(interval));

	const [error, setError] = createSignal("");

	// Solid tuple handlers call fn(arg, event)
	async function run(fn: (fd: FormData) => Promise<unknown>, e: Event) {
		e.preventDefault();
		setError("");
		const fd = new FormData(e.target as HTMLFormElement);
		fd.set("_referer", location.pathname);
		const result = (await fn(fd)) as { error?: string } | undefined;
		if (result?.error) setError(result.error);
	}

	function handleDiscard() {
		if (!confirm("Discard this timer? Tracked time will be lost.")) return;
		const fd = new FormData();
		fd.set("_referer", location.pathname);
		discard(fd);
	}

	return (
		<div class="timer-widget">
			<Show
				when={timer()}
				keyed
				fallback={
					<form onSubmit={[run, start]}>
						<div class="timer-widget-label">Timer</div>
						<select name="project_id" required>
							<option value="" disabled selected>
								Project…
							</option>
							<For each={projects()?.filter((p) => p.status === "active")}>
								{(p) => (
									<option value={p.id}>
										{p.name} — {p.companyName}
									</option>
								)}
							</For>
						</select>
						<input
							name="description"
							placeholder="What are you working on?"
						/>
						<button type="submit" class="timer-start">
							▶ Start
						</button>
					</form>
				}
			>
				{(t) => (
					<>
						<div class="timer-widget-label">Timer</div>
						<div class="timer-elapsed">
							{fmtElapsed(now() - new Date(t.startedAt).getTime())}
						</div>
						<div class="timer-project">
							{t.projectName}
							<span> · {t.companyName}</span>
						</div>
						<Show when={t.description}>
							<div class="timer-desc">{t.description}</div>
						</Show>
						<form onSubmit={[run, stop]}>
							<button type="submit" class="timer-stop">
								■ Stop &amp; log
							</button>
						</form>
						<button type="button" class="timer-discard" onClick={handleDiscard}>
							Discard
						</button>
					</>
				)}
			</Show>
			<Show when={error()}>
				<div class="timer-error">{error()}</div>
			</Show>
		</div>
	);
}
