// Live Dispatch issue — SSR straight from the DB. The moment the scheduler
// publishes a newsletter it appears here (and in the /newsletter archive),
// no rebuild, no redeploy.
import { Title } from "@solidjs/meta";
import { useParams } from "@solidjs/router";
import { Show, Suspense, createResource } from "solid-js";
import MarketingPage from "~/components/marketing/MarketingPage";
import { Header } from "~/components/marketing/Header";
import { Footer } from "~/components/marketing/Footer";
import { getDispatchIssueQuery } from "~/lib/dispatch-queries";
import { newsletterSubject, renderIssueBody } from "~/lib/publish-core";
import "~/styles/marketing-issue.css";

export default function DispatchIssuePage() {
	const params = useParams();
	const [issue] = createResource(() =>
		getDispatchIssueQuery(params.id ?? "").then((i) => {
			if (!i) return null;
			// the snapshot published/republished to the web — edits after publish
			// keep rendering the old version here until republished. The web
			// appendix renders after the body; /brain links carry ?ref= so the
			// request attributes itself to this issue.
			const md = i.webMarkdown ?? i.markdown;
			const html = renderIssueBody(md, i.webAppendix, "web")
				.replaceAll('href="/brain"', `href="/brain?ref=${i.id}"`)
				.replaceAll('href="https://madcactus.org/brain"', `href="/brain?ref=${i.id}"`);
			return { ...i, subject: newsletterSubject({ markdown: md, title: i.title }), html };
		}),
	);
	return (
		<Suspense fallback={<div style={{ "min-height": "60vh", display: "grid", "place-items": "center" }}>Loading…</div>}>
			<Show when={issue()}>
				{(i) => (
					<MarketingPage title={`${i().subject} — The Cactus Dispatch`} description={i().subject}>
						<Title>{i().subject} — The Cactus Dispatch</Title>
						<Header />
						<article class="issue">
							<div class="issue-inner">
								<p class="issue-eyebrow">
									<a href="/newsletter">The Cactus Dispatch</a> &nbsp;/&nbsp; Issue {String(i().issueNumber).padStart(2, "0")}
								</p>
								<h1 class="issue-title">{i().subject}</h1>
								{/* published issue html — the exact render the email send uses */}
								<div class="issue-body" innerHTML={i().html} />
								<div class="issue-cta">
									<h3>Want to start turning your company AI-native?</h3>
									<p>I build a custom company brain for one reader every week, completely free. All you have to do is click below.</p>
									<a href={`/brain?ref=${i().id}`} class="cta-bracketed">
										&#123; GET YOUR COMPANY BRAIN &#125;
									</a>
								</div>
							</div>
						</article>
						<Footer />
					</MarketingPage>
				)}
			</Show>
		</Suspense>
	);
}
