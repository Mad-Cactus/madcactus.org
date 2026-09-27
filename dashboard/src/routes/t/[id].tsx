// Public teaser page — /t/:id renders one doc of genre "teaser" as a single
// screen: the three findings from the rung-1 outreach email, plus the weekly
// line. The tracked /l/:slug short link in the email 302s here; every human
// click counts on the slug, so "click + return" (the gate) = clicks ≥ 2.
// No auth on purpose — this IS the link prospects click.
import { Title } from "@solidjs/meta";
import { useParams } from "@solidjs/router";
import { createResource, Show } from "solid-js";
import { getTeaser } from "~/lib/teaser";
import { markdownToHtml } from "~/lib/publish-core";
import { renderMentionsInMarkdown } from "~/lib/mention-render-server";
import Layout from "~/components/Layout";

export default function TeaserPage() {
	const params = useParams();
	const [teaser] = createResource(() => getTeaser(params.id ?? ""));
	// mentions render as live chips (label from the registry at request time)
	const [body] = createResource(() => (teaser() ? renderMentionsInMarkdown(teaser()!.markdown).then(markdownToHtml) : ""));
	return (
		<Show when={teaser()} fallback={<p class="muted">Not found.</p>}>
			{(t) => (
				<Layout user={null}>
					<Title>{t().title} — Mad Cactus</Title>
					<article class="teaser" style={{ "max-width": "640px", margin: "48px auto", padding: "0 20px" }}>
						<h1 style={{ "font-family": "var(--font-serif)", "font-weight": "400", "font-size": "28px" }}>{t().title}</h1>
						<div class="teaser-body" innerHTML={body()} />
					</article>
				</Layout>
			)}
		</Show>
	);
}
