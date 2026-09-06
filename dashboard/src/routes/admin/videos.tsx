import { Title } from "@solidjs/meta";
import { createAsync, useAction } from "@solidjs/router";
import { For, Show, Suspense, createSignal } from "solid-js";
import Layout from "~/components/Layout";
import { getUserQuery } from "~/lib/queries";
import { getOutreachQuery, setOutreachVideoAction } from "~/lib/admin-queries";
import { videoSummary } from "~/lib/video-summary";

export default function AdminVideos() {
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const outreach = createAsync(() => getOutreachQuery(), { deferStream: true });
	const saveVideo = useAction(setOutreachVideoAction);
	const [error, setError] = createSignal("");
	const [message, setMessage] = createSignal("");

	const vids = () => (outreach()?.all ?? []).filter((p) => p.videoUrl);

	async function handleLink(e: Event) {
		e.preventDefault();
		setError("");
		setMessage("");
		const res = (await saveVideo(new FormData(e.target as HTMLFormElement))) as { error?: string; success?: string };
		if (res.error) {
			setError(res.error);
			return;
		}
		setMessage(res.success ?? "Video saved.");
	}

	return (
		<Layout user={user()}>
			<Title>Videos — Mad Cactus</Title>
			<h1 class="page-title">Outreach Videos</h1>
			<p class="page-subtitle">
				Videos linked to prospects. Copy the email link for sends (tracked); use test to preview without polluting metrics.
			</p>

			<details style={{ "margin-bottom": "24px" }}>
				<summary style={{ cursor: "pointer", "font-weight": "600" }}>Link a video to a prospect</summary>
				<form onSubmit={handleLink} style={{ display: "grid", gap: "8px", "max-width": "640px", "margin-top": "12px" }}>
					<select name="id" required>
						<For each={outreach()?.all ?? []}>
							{(p) => (
								<option value={p.id}>
									{p.company}
									{p.videoUrl ? " (replaces current)" : ""}
								</option>
							)}
						</For>
					</select>
					<input type="url" name="video_url" placeholder="Video URL (cap.so share link) *" required />
					<input type="text" name="video_description" placeholder="Description — what it shows / why it exists" />
					<button type="submit" class="btn btn-primary">Save video</button>
				</form>
			</details>
			<Show when={error()}>
				<p class="login-error">{error()}</p>
			</Show>
			<Show when={message()}>
				<p class="muted">{message()}</p>
			</Show>

			<Suspense fallback={<p class="muted">Loading…</p>}>
				<Show
					when={vids().length}
					fallback={<p class="muted">No videos linked yet — link one above or set a Video URL on a prospect's card.</p>}
				>
					<div style={{ display: "grid", gap: "16px", "max-width": "640px" }}>
						<For each={vids()}>
							{(p) => (
								<div class="board-card">
									<div style={{ display: "flex", "align-items": "baseline", gap: "6px" }}>
										<span style={{ "font-weight": "600", "font-size": "13px" }}>{p.company}</span>
										<span class="badge" style={{ color: "var(--text-subtle)", "margin-left": "auto" }}>{p.stage}</span>
									</div>
									<Show when={p.videoDescription}>
										<p class="muted" style={{ "font-size": "12px", margin: "4px 0" }}>{p.videoDescription}</p>
									</Show>
									<div style={{ "font-size": "12px", margin: "5px 0" }}>
										<a href={p.videoUrl!} target="_blank" rel="noreferrer">video ↗</a>{" "}
										<button
											type="button"
											class="btn btn-sm"
											onClick={() => navigator.clipboard.writeText(`${location.origin}/v/${p.id}`)}
										>
											copy email link
										</button>{" "}
										<a href={`/v/${p.id}?test=1`} target="_blank" rel="noreferrer">test ↗</a>
									</div>
									<Show when={videoSummary(p)}>
										<div style={{ color: "var(--orange)", "font-size": "12px" }}>{videoSummary(p)}</div>
									</Show>
								</div>
							)}
						</For>
					</div>
				</Show>
			</Suspense>
		</Layout>
	);
}
