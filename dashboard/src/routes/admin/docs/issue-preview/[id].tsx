// Live-issue preview for the admin editor's "Web preview" tab. Renders the
// EXACT components + stylesheet the public /newsletter/<id> page uses, but for
// ANY doc status (drafts/scheduled too) — what you see is what will ship.
// Admin-only through the same server query the editor uses. No admin chrome —
// this document must look like the marketing site, because it is one.
import { Title } from "@solidjs/meta";
import { useParams, createAsync } from "@solidjs/router";
import { Show } from "solid-js";
import MarketingPage from "~/components/marketing/MarketingPage";
import { Header } from "~/components/marketing/Header";
import { Footer } from "~/components/marketing/Footer";
import { getDocQuery } from "~/lib/docs-queries";
import { markdownToHtml, newsletterSubject } from "~/lib/publish-core";
import "~/styles/marketing-issue.css";

export default function DispatchIssuePreviewPage() {
	const params = useParams();
	const doc = createAsync(() => getDocQuery(params.id ?? ""), { deferStream: true });
	return (
		<Show when={doc()}>
			{(d) => {
				const subject = () => newsletterSubject({ markdown: d().markdown, title: d().title });
				return (
					<MarketingPage title={`${subject()} — The Cactus Dispatch`} description={subject()}>
						<Title>{subject()} — The Cactus Dispatch (preview)</Title>
						<Header />
						<article class="issue">
							<div class="issue-inner">
								<p class="issue-eyebrow">
									<a href="/newsletter">The Cactus Dispatch</a> &nbsp;/&nbsp; Preview
								</p>
								<h1 class="issue-title">{subject()}</h1>
								<div class="issue-body" innerHTML={markdownToHtml(d().markdown, "web")} />
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
				);
			}}
		</Show>
	);
}
