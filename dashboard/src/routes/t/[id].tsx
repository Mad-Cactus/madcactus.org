// Public teaser page — /t/:id renders one doc of genre "teaser" as a single
// screen: the three findings from the rung-1 outreach email, plus the weekly
// line. The tracked /l/:slug short link in the email 302s here; every human
// click counts on the slug, so "click + return" (the gate) = clicks ≥ 2.
// No auth on purpose — this IS the link prospects click.
import { Title } from "@solidjs/meta";
import { useParams } from "@solidjs/router";
import { createResource, Show } from "solid-js";
import { eq, and } from "drizzle-orm";
import { db } from "~/db";
import { docs } from "~/db/schema";
import { markdownToHtml } from "~/lib/publish-core";
import Layout from "~/components/Layout";

async function getTeaser(id: string) {
	const [row] = await db
		.select({ id: docs.id, title: docs.title, markdown: docs.markdown })
		.from(docs)
		.where(and(eq(docs.id, id), eq(docs.genre, "teaser")))
		.limit(1);
	return row ?? null;
}

export default function TeaserPage() {
	const params = useParams();
	const [teaser] = createResource(() => getTeaser(params.id ?? ""));
	return (
		<Show when={teaser()} fallback={<p class="muted">Not found.</p>}>
			{(t) => (
				<Layout user={null}>
					<Title>{t().title} — Mad Cactus</Title>
					<article class="teaser" style={{ "max-width": "640px", margin: "48px auto", padding: "0 20px" }}>
						<h1 style={{ "font-family": "var(--font-serif)", "font-weight": "400", "font-size": "28px" }}>{t().title}</h1>
						<div class="teaser-body" innerHTML={markdownToHtml(t().markdown)} />
					</article>
				</Layout>
			)}
		</Show>
	);
}
