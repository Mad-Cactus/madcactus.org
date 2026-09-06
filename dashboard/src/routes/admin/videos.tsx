import { Title } from "@solidjs/meta";
import { createAsync } from "@solidjs/router";
import { For, Show, Suspense } from "solid-js";
import Layout from "~/components/Layout";
import { getUserQuery } from "~/lib/queries";
import { getOutreachQuery } from "~/lib/admin-queries";
import { videoSummary } from "~/lib/video-summary";

export default function AdminVideos() {
	const user = createAsync(() => getUserQuery(), { deferStream: true });
	const outreach = createAsync(() => getOutreachQuery(), { deferStream: true });
	const vids = () => (outreach()?.all ?? []).filter((p) => p.videoUrl);

	return (
		<Layout user={user()}>
			<Title>Videos — Mad Cactus</Title>
			<h1 class="page-title">Outreach Videos</h1>
			<p class="page-subtitle">
				Every video linked to a prospect. The email link (/v/…) is the tracked one — copy that into sends, never the CAP link.
			</p>
			<Suspense fallback={<p class="muted">Loading…</p>}>
				<Show
					when={vids().length}
					fallback={<p class="muted">No videos linked yet — set a Video URL on a prospect's outreach card.</p>}
				>
					<div style={{ display: "grid", gap: "16px", "max-width": "640px" }}>
						<For each={vids()}>
							{(p) => (
								<div class="board-card">
									<div style={{ display: "flex", "align-items": "baseline", gap: "6px" }}>
										<span style={{ "font-weight": "600", "font-size": "13px" }}>{p.company}</span>
										<span class="badge" style={{ color: "var(--text-subtle)", "margin-left": "auto" }}>{p.stage}</span>
									</div>
									<div style={{ "font-size": "12px", margin: "5px 0" }}>
										<a href={p.videoUrl!} target="_blank" rel="noreferrer">video ↗</a>{" "}
										<code style={{ "font-size": "11px" }}>/v/{p.id}</code>{" "}
										<button
											type="button"
											class="btn btn-sm"
											onClick={() => navigator.clipboard.writeText(`${location.origin}/v/${p.id}`)}
										>
											copy email link
										</button>
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
