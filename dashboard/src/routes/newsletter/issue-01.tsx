// Issue 01 — hand-built static page, kept at its original URL for SEO.
// Later issues live in the DB and render at /newsletter/:id.
// ponytail: port this issue into a DB doc eventually, then delete this file
// and the STATIC_ISSUE_OFFSET in lib/dispatch.ts.

import { onMount } from "solid-js";
import MarketingPage from "~/components/marketing/MarketingPage";
import { Header } from "~/components/marketing/Header";
import { Footer } from "~/components/marketing/Footer";
import "~/styles/marketing-issue.css";

function setupCopyBtn(btnId: string, blockId: string, promptName: string) {
	const btn = document.getElementById(btnId);
	if (!btn) return;
	btn.addEventListener("click", () => {
		const code = document.getElementById(blockId)!.textContent;
		navigator.clipboard.writeText(code ?? "").then(() => {
			btn.textContent = "Copied";
			btn.classList.add("copied");
			window.posthog?.capture("prompt_copied", { from: "issue_01", prompt: promptName });
			setTimeout(() => {
				btn.textContent = "Copy";
				btn.classList.remove("copied");
			}, 2000);
		});
	});
}

export default function Issue01() {
	onMount(() => {
		setupCopyBtn("copyPromptBtn", "promptBlock", "main");
		setupCopyBtn("copySourceBtn", "sourcePromptBlock", "data_source");
		setupCopyBtn("copyInstallBtn", "installBlock", "install_cmd");
		setupCopyBtn("copyVerifyBtn", "verifyPromptBlock", "verification");
	});
	return (
		<MarketingPage
			title="Teardown #1: 585 warm prospects in 16 minutes — The Cactus Dispatch"
			description="We turned public records into 585 ranked sales prospects in 16 minutes using a coding agent. Here's the prompt and the verification loop."
		>
			<Header />
			<article class="issue">
				<div class="issue-inner">
					<p class="issue-eyebrow">
						<a href="/newsletter">The Cactus Dispatch</a> &nbsp;/&nbsp; Issue 01
					</p>
					<h1 class="issue-title">
						3,000 cold emails, zero replies.
						<br />
						Then we found 585 warm prospects
						<br />
						<em>in 16 minutes.</em>
					</h1>

					<div class="issue-tldr">
						<strong>TL;DR</strong> — We turned public records into 585 ranked sales prospects in 16 minutes using a coding agent. Here's the{" "}
						<a href="#data-source">data source discovery</a>, the <a href="#main-prompt">build prompt</a> and the{" "}
						<a href="#verification">verification loop</a> that made it trustworthy.
					</div>

					<h2 class="issue-beat">The tension</h2>
					<p>
						A company sent three thousand cold emails and got zero replies. The reflex is to rewrite the pitch, hire a
						copywriter, test new subject lines. We did something cheaper and faster first: we built a tool to find out
						whether the message was broken, or the audience was.
					</p>

					<h2 class="issue-beat">What we did</h2>
					<p>
						The client sells protection against a specific kind of data exposure. Their hardest sale is to companies that
						don't yet know they're exposed, which means most of their cold outreach is education, not selling.
					</p>
					<p>
						So we went after the one group that already understood: companies that had bought this protection, then let
						it lapse. When the protection lapses, the problem returns, and the company feels it firsthand.
					</p>
					<p>
						We used a coding agent (Claude Code) to build a Python scraper that pulls public records, flags every company
						whose protection lapsed in the last six to eighteen months, and ranks them by exposure level. The agent also
						built a Streamlit dashboard: a simple web page the sales team could open in a browser, filter prospects, and
						see who was most exposed today. The first working version took about sixteen minutes.
					</p>

					<h2 class="issue-beat">The pattern</h2>
					<p>
						If your sales team is doing cold outreach to people who don't know they have a problem yet, you're selling
						education. That's slow and expensive. The faster path: find the people who already feel the pain. Every
						industry has a signal: expired contracts, lapsed coverage, compliance violations, public filings, license
						renewals. That signal is usually public data sitting in a database somewhere, free to scrape.
					</p>
					<p>
						A coding agent can turn that data into a ranked prospect list in under an hour. The cost is a few dollars in
						compute. The shift is strategic: you stop guessing who might need you and start calling the people who
						already do.
					</p>

					<h2 class="issue-beat">How we knew it was right</h2>
					<p>
						The agent's first attempt was wrong. It invented field names that didn't exist in the source data and built
						a schema around fields it had hallucinated. This is the most common failure mode for coding agents: they
						sound confident, the code runs, but it's operating on a fiction.
					</p>
					<p>
						The fix was one step: we found a single real record from the source, pasted it into the prompt, and said
						"use these exact field names." The agent corrected itself immediately. Every field after that matched
						reality.
					</p>
					<p>
						Then we built a verification loop. For each company the tool flagged as exposed, it cross-referenced against
						the live source to confirm the status was real, not cached, not guessed. Any mismatch got flagged for manual
						review. Out of 585 companies scored, three were wrong. The loop caught all three before anyone acted on
						them.
					</p>
					<p>
						If your team is building tools with coding agents and skipping verification, you're trusting output that
						hasn't been checked. The verification loop took longer to build than the tool itself. It was worth it.
					</p>

					<h2 class="issue-beat">What happened</h2>
					<p>
						The dashboard went into a stakeholder meeting with the sales team. Instead of debating which companies to
						target next, they were looking at a ranked list of 585 prospects already in pain. The conversation shifted
						from "who do we educate?" to "who do we call first?"
					</p>
					<p>
						The team identified three companies scoring above 80 on the exposure index: companies whose protection had
						lapsed within the last 90 days. Those became the priority outreach targets for the following week.
					</p>
					<p>
						Separately, the email problem turned out to be a one-line fix: the three thousand emails were going out as
						HTML, and spam filters were treating them like marketing. Nobody noticed until the prospecting tool proved
						the audience wasn't the bottleneck.
					</p>

					<h2 class="issue-beat">The blueprint</h2>

					<p class="issue-subhead">THE STACK</p>
					<ul>
						<li>
							<strong>For your team:</strong> Claude Code or any coding agent (Codex, pi)
						</li>
						<li>
							<strong>Install:</strong> Python 3.12+, then run:
						</li>
					</ul>

					<div class="prompt-wrap prompt-inline">
						<button class="copy-btn" id="copyInstallBtn" aria-label="Copy install command">
							Copy
						</button>
						<pre class="prompt-block" id="installBlock">
							<code>pip install streamlit plotly</code>
						</pre>
					</div>

					<ul>
						<li>
							<strong>Cost to run:</strong> Free through Streamlit
						</li>
						<li>
							<strong>What it produces:</strong> A ranked list of your most likely buyers, already in pain
						</li>
					</ul>

					<p class="issue-subhead" id="data-source">
						FINDING YOUR DATA SOURCE
					</p>

					<div class="prompt-wrap">
						<button class="copy-btn" id="copySourceBtn" aria-label="Copy prompt">
							Copy
						</button>
						<pre class="prompt-block" id="sourcePromptBlock">
							<code>{`I sell [your product] to [your ideal customer].
My customers buy when they realize [the problem].

I need public data to find companies experiencing
this problem right now.

Search for data sources specific to my industry:
1. Government databases and registries that track
   companies in my space
2. Free APIs or public search portals
3. Customs, licensing, compliance, or filing records
4. data.gov, Socrata, state/county registries
5. Industry-specific public databases

For each source you find, tell me:
- URL and whether it's free
- What fields are available
- How to access (API, scrape, or download)
- How far back the data goes

Then pick the best free source and explain how to
structure a scraper for it.

Example: if my customers are importers, ImportYeti
(free US customs records) would be a strong source
because it shows every shipment by company name.`}</code>
						</pre>
					</div>

					<p class="issue-subhead" id="main-prompt">
						THE PROMPT
					</p>

					<div class="prompt-wrap">
						<button class="copy-btn" id="copyPromptBtn" aria-label="Copy prompt">
							Copy
						</button>
						<pre class="prompt-block" id="promptBlock">
							<code>{`I sell [your product] to [your ideal customer].
My customers buy when they realize [the problem].

Data source: [the source you found in step 1]
Access method: [API, scrape, or download]

CRITICAL: paste ONE real record from the source below.
The agent will hallucinate field names without it.
[paste one real record here]

Build a Python tool that:
1. Pulls all records from the source
2. Finds companies currently in [the problem state]
3. Scores each company on fit and urgency:
   - How closely they match your ideal customer
   - How recently the problem signal appeared
   - How severe the signal is
4. Ranks companies by score (0-100)
5. Outputs a Streamlit dashboard with:
   - Filterable, sortable table
   - Score breakdown per company
   - Export to CSV button

Name fields exactly as they appear in the real record above.`}</code>
						</pre>
					</div>

					<p class="issue-subhead" id="verification">
						VERIFICATION LOOP
					</p>

					<p>
						The agent's first pass had invented field names. The verification function was the safety net: for every
						company the tool flagged, it re-fetched the live source page and confirmed the data matched. Any row that
						didn't match went to a manual review list. Out of 585 companies, three were wrong. The loop caught all three.
					</p>

					<div class="prompt-wrap">
						<button class="copy-btn" id="copyVerifyBtn" aria-label="Copy prompt">
							Copy
						</button>
						<pre class="prompt-block" id="verifyPromptBlock">
							<code>{`Add a verification function to the tool that:
1. For each company in the results, re-fetches the
   source page and confirms the record still exists
2. Compares every field against what the tool
   originally captured
3. Flags any mismatch in a separate list called
   "needs_manual_review.csv"
4. Logs how many records passed vs failed

Run this after every scrape. Do not trust the output
until verification passes.`}</code>
						</pre>
					</div>

					<p>The dashboard makes the data visible to non-technical stakeholders in a meeting. A CSV doesn't do that.</p>

					<div class="issue-footer-note">
						<p>
							Full source code and data source guide on{" "}
							<a href="https://github.com/aspectrr/prospect-scrape">GitHub&nbsp;→</a>
						</p>
					</div>

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
}
