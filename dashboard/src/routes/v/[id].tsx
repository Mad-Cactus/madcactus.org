import { Title } from "@solidjs/meta";
import { useParams, useSearchParams } from "@solidjs/router";
import { createResource, Match, Show, Switch, createSignal, onCleanup } from "solid-js";
import "plyr/dist/plyr.css";
import { getTrackedVideo } from "~/lib/watch-video";

// Watch page for tracked outreach video links: the email points at /v/:id.
// Plyr skins the native <video> (speed menu, PiP, keyboard shortcuts) but
// still drives the raw element underneath, so v-watch.js keeps getting real
// play/pause/progress events — opens are beaconed on load.
// ponytail: prospect UUID is the token; swap for a random track_token if
// links ever get shared beyond one email.

/** Playable stream URL: cap.so share link → its signed mp4 playlist;
 *  direct .mp4 URL (e.g. the Supabase videos bucket) → itself; else null. */
function playableUrl(url: string): string | null {
	const m = url.match(/cap\.so\/(?:s|embed)\/([\w-]+)/);
	if (m) return `https://cap.so/api/playlist?videoId=${m[1]}&videoType=mp4`;
	return /\.mp4($|\?)/i.test(url) ? url : null;
}

export default function WatchVideo() {
	const params = useParams();
	const [searchParams] = useSearchParams();
	const [video] = createResource(() => getTrackedVideo(params.id ?? ""));
	const [copied, setCopied] = createSignal(false);
	// plyr's types are CJS (export =); type the two things we use structurally.
	type PlyrInstance = { destroy(): void };
	type PlyrCtor = new (el: HTMLElement, options?: Record<string, unknown>) => PlyrInstance;
	let player: PlyrInstance | undefined;
	onCleanup(() => player?.destroy());

	// plyr is imported lazily here: the route renders on the server too, and
	// the ref callback only runs once the Match resolves client-side.
	async function initPlayer(el: HTMLVideoElement) {
		const mod = (await import("plyr")) as unknown as { default: PlyrCtor };
		player = new mod.default(el, {
			controls: [
				"play-large",
				"play",
				"progress",
				"current-time",
				"duration",
				"mute",
				"volume",
				"settings",
				"pip",
				"fullscreen",
				"download",
			],
			settings: ["speed"],
			speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] },
			keyboard: { focused: true, global: true },
			tooltips: { controls: true, seek: true },
		});
	}

	function copyLink() {
		navigator.clipboard.writeText(location.href);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}

	return (
		<Switch
			fallback={
				<main style={{ "background-color": "#111", "min-height": "100vh", padding: "48px 24px" }}>
					<Title>Not found — Mad Cactus</Title>
				</main>
			}
		>
			<Match when={video()}>
				{(v) => (
					<main
						style={{
							margin: "0",
							"background-color": "#111",
							"min-height": "100vh",
							padding: "32px 24px",
							color: "#eee",
						}}
					>
						<Title>{v().company} — Mad Cactus</Title>
						<Switch
							fallback={
								// Other hosts (e.g. YouTube): no native stream, bounce to the raw URL.
								<meta http-equiv="refresh" content={`0;url=${v().videoUrl!}`} />
							}
						>
							<Match when={playableUrl(v().videoUrl!)}>
								{(src) => (
									<div
										style={{
											width: "100%",
											"max-width": "1280px",
											margin: "0 auto",
											display: "grid",
											gap: "12px",
										}}
									>
										<style>{`
											.video-shell {
												--plyr-color-main: #c4862a;
												border-radius: 12px;
												overflow: hidden;
												background: #000;
											}
											.video-shell video {
												display: block;
												width: 100%;
												height: auto;
												max-height: 82vh;
											}
										`}</style>
										<div style={{ display: "flex", "align-items": "baseline", gap: "12px" }}>
											<div style={{ "min-width": 0 }}>
												<h1 style={{ margin: 0, "font-size": "18px", "font-weight": 600 }}>{v().company}</h1>
												<Show when={v().videoDescription}>
													<p style={{ margin: "2px 0 0", "font-size": "13px", color: "#999" }}>
														{v().videoDescription}
													</p>
												</Show>
											</div>
											<button
												type="button"
												onClick={copyLink}
												style={{
													"margin-left": "auto",
													flex: "none",
													background: "#2a2a2a",
													color: "#eee",
													border: "1px solid #3a3a3a",
													"border-radius": "8px",
													padding: "6px 14px",
													"font-size": "13px",
													cursor: "pointer",
												}}
											>
												{copied() ? "Copied" : "Copy link"}
											</button>
										</div>
										<div class="video-shell">
											<video ref={(el) => initPlayer(el)} src={src()} controls playsinline preload="metadata" />
										</div>
									</div>
								)}
							</Match>
						</Switch>
						{/* test=1 = Collin previewing the video — no tracker, zero metrics */}
						<Show when={!searchParams.test}>
							<script src="/v-watch.js" data-prospect-id={v().id} />
						</Show>
					</main>
				)}
			</Match>
		</Switch>
	);
}
