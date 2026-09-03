import { Title } from "@solidjs/meta";
import { useParams } from "@solidjs/router";
import { createResource, Match, Switch } from "solid-js";
import { getTrackedVideo } from "~/lib/watch-video";

// Watch page for tracked outreach video links: the email points at /v/:id.
// Read-only render — the open + watch-time are logged by public/v-watch.js
// beaconing POST /api/video-event, so hydration re-runs can't double-count.
// ponytail: prospect UUID is the token; swap for a random track_token if
// links ever get shared beyond one email.

/** cap.so share/embed URL → embeddable player URL; null for other hosts. */
function capEmbedUrl(url: string): string | null {
	const m = url.match(/cap\.so\/(?:s|embed)\/([\w-]+)/);
	return m ? `https://cap.so/embed/${m[1]}` : null;
}

export default function WatchVideo() {
	const params = useParams();
	const [video] = createResource(() => getTrackedVideo(params.id ?? ""));

	return (
		<Switch fallback={<main style={{ "background-color": "#111", "min-height": "100vh", padding: "48px 24px" }}><Title>Not found — Mad Cactus</Title></main>}>
			<Match when={video()}>
				{(v) => (
					<main style={{ margin: "0", "background-color": "#111", "min-height": "100vh" }}>
						<Title>{v().company} — Mad Cactus</Title>
						<Switch
							fallback={
								// Non-cap video hosts: no player to embed, bounce to the raw URL.
								<meta http-equiv="refresh" content={`0;url=${v().videoUrl!}`} />
							}
						>
							<Match when={capEmbedUrl(v().videoUrl!)}>
								{(embed) => (
									<iframe
										src={embed()}
										allow="autoplay; fullscreen"
										style={{ display: "block", width: "100%", height: "100vh", border: "0" }}
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
