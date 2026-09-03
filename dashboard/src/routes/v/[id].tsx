import { Title } from "@solidjs/meta";
import { useParams } from "@solidjs/router";
import { createResource, Match, Switch } from "solid-js";
import { getTrackedVideo } from "~/lib/watch-video";

// Watch page for tracked outreach video links: the email points at /v/:id.
// The video plays in a native <video> fed by cap.so's playlist endpoint
// (same signed stream the cap player uses), so v-watch.js gets real
// play/pause/progress events — opens are beaconed on load.
// ponytail: prospect UUID is the token; swap for a random track_token if
// links ever get shared beyond one email.

/** cap.so share/embed URL → mp4 playlist stream URL; null for other hosts. */
function capPlaylistUrl(url: string): string | null {
	const m = url.match(/cap\.so\/(?:s|embed)\/([\w-]+)/);
	return m ? `https://cap.so/api/playlist?videoId=${m[1]}&videoType=mp4` : null;
}

export default function WatchVideo() {
	const params = useParams();
	const [video] = createResource(() => getTrackedVideo(params.id ?? ""));

	return (
		<Switch fallback={<main style={{ "background-color": "#111", "min-height": "100vh", padding: "48px 24px" }}><Title>Not found — Mad Cactus</Title></main>}>
			<Match when={video()}>
				{(v) => (
					<main
						style={{
							margin: "0",
							"background-color": "#111",
							"min-height": "100vh",
							display: "flex",
							"align-items": "center",
							"justify-content": "center",
						}}
					>
						<Title>{v().company} — Mad Cactus</Title>
						<Switch
							fallback={
								// Non-cap video hosts: no stream to play natively, bounce to the raw URL.
								<meta http-equiv="refresh" content={`0;url=${v().videoUrl!}`} />
							}
						>
							<Match when={capPlaylistUrl(v().videoUrl!)}>
								{(src) => (
									<video
										src={src()}
										controls
										playsinline
										preload="metadata"
										style={{ width: "100%", "max-width": "1280px", "max-height": "100vh", "background-color": "#000" }}
									/>
								)}
							</Match>
						</Switch>
						<script src="/v-watch.js" data-prospect-id={v().id} />
					</main>
				)}
			</Match>
		</Switch>
	);
}
