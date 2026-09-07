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
import { markdownToHtml, newsletterSubject } from "~/lib/publish-core";
import "~/styles/marketing-issue.css";

export default function DispatchIssuePage() {
	const params = useParams();
	const [issue] = createResource(() =>
		getDispatchIssueQuery(params.id ?? "").then((i) =>
			i ? { ...i, subject: newsletterSubject({ markdown: i.markdown, title: i.title }), html: markdownToHtml(i.markdown) } : null,
		),
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
									<h3>Where could AI save your team time?</h3>
									<p>The AI Readiness Scorecard takes 5 minutes. No email required.</p>
									<a href="/scorecard" class="cta-bracketed">
										&#123; TAKE THE SCORECARD &#125;
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
