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
import { newsletterSubject, renderIssueBody } from "~/lib/publish-core";
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
								<div class="issue-body" innerHTML={renderIssueBody(d().markdown, d().webAppendix, "web")
								.replaceAll('href="/brain"', `href="/brain?ref=${d().id}"`)
								.replaceAll('href="https://madcactus.org/brain"', `href="/brain?ref=${d().id}"`)} />
								<div class="issue-cta">
									<h3>Want one of these for your company?</h3>
									<p>I build a custom company brain for a few businesses each month — free.</p>
									<a href={`/brain?ref=${d().id}`} class="cta-bracketed">
										&#123; GET YOUR FREE COMPANY BRAIN &#125;
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
