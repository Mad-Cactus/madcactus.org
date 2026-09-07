// Newsletter landing — SSR (not prerendered) so the archive always lists
// freshly published issues straight from the DB.
import { createAsync } from "@solidjs/router";
import { For, Show, onMount } from "solid-js";
import MarketingPage from "~/components/marketing/MarketingPage";
import { Header } from "~/components/marketing/Header";
import { Footer } from "~/components/marketing/Footer";
import { subscribeToNewsletter } from "~/components/marketing/subscribe";
import { getDispatchIssuesQuery } from "~/lib/dispatch-queries";
import "~/styles/marketing-newsletter.css";

export default function Newsletter() {
	const issues = createAsync(() => getDispatchIssuesQuery());

	onMount(() => {
		// traffic source on newsletter landing (marketing PostHog project)
		const ph = window.posthog;
		if (ph) {
			const ref = document.referrer;
			const params = new URLSearchParams(window.location.search);
			ph.capture("newsletter_landed", {
				source: params.get("utm_source") || (ref ? new URL(ref).hostname : "direct"),
				referrer: ref,
				path: window.location.pathname,
			});
		}

		const form = document.getElementById("signupForm") as HTMLFormElement | null;
		if (!form) return;
		form.addEventListener("submit", async (e) => {
			e.preventDefault();
			const email = form.email.value.trim();
			const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
			btn.textContent = "Subscribing...";
			btn.disabled = true;
			const res = await subscribeToNewsletter(email);
			if (res.ok) {
				form.innerHTML = '<p class="signup-success">You\'re in. Check your inbox.</p>';
			} else {
				btn.textContent = "{ SUBSCRIBE }";
				btn.disabled = false;
			}
		});
	});

	return (
		<MarketingPage
			title="The Cactus Dispatch | Mad Cactus"
			description="Weekly AI teardowns for business owners. Real deployments, real numbers, and the blueprint your team needs to build the same thing."
		>
			<Header />

			{/* ════════ HERO ════════ */}
			<section class="hero">
				<div class="hero-inner">
					<div class="hero-text">
						<h1 class="hero-headline">
							AI teardowns
							<br />
							<em>from our real clients.</em>
						</h1>
						<p class="hero-body">
							Weekly breakdowns of real AI deployments. What we built, what it cost, and the blueprint to do the
							same thing. Higher margins, more revenue, no new headcount.
						</p>

						<form class="signup-form" id="signupForm">
							<input type="email" name="email" placeholder="your@email.com" required autocomplete="email" />
							<button type="submit" class="cta-bracketed cta-hero" data-ph-event="newsletter_signup">
								&#123; SUBSCRIBE &#125;
							</button>
						</form>
					</div>
				</div>
			</section>

			{/* ════════ WHAT YOU GET ════════ */}
			<section id="what-you-get">
				<div class="section-header">
					<h2 class="section-title">What you get</h2>
					<hr class="section-rule" />
				</div>
				<div class="features-grid">
					<div class="feature-col">
						<div class="feature-num">01</div>
						<h3>The story</h3>
						<p>
							The company, the problem, why it mattered. What we deployed and where it moved the needle.
						</p>
					</div>
					<div class="feature-col">
						<div class="feature-num">02</div>
						<h3>The blueprint</h3>
						<p>
							The full agent lifecycle. The tools, the prompts, the evals. Forward it to your team each week for a
							quick AI win.
						</p>
					</div>
					<div class="feature-col">
						<div class="feature-num">03</div>
						<h3>The numbers</h3>
						<p>Real cost, real hours saved, real revenue. No hypotheticals — what actually happened when it shipped.</p>
					</div>
				</div>
			</section>

			{/* ════════ PAST ISSUES — server-rendered from the DB, SEO-complete ════════ */}
			<section id="past-issues">
				<div class="archive-inner">
					<a href="/newsletter/issue-01" class="archive-card">
						<div class="archive-meta">
							<span class="archive-num">Issue 01</span>
							<span class="archive-date">January 2026</span>
						</div>
						<h3 class="archive-title">3,000 cold emails, zero replies. Then we found 585 warm prospects in 16 minutes.</h3>
						<p class="archive-desc">
							How a coding agent turned public records into a ranked sales dashboard. The prompt, the verification
							loop, and what happened when the sales team saw it.
						</p>
						<span class="archive-link">&#123; READ THE TEARDOWN &#125;</span>
					</a>
				</div>
				<Show when={issues()?.length}>
					<div class="archive-inner" style={{ "margin-top": "24px" }}>
						<For each={issues()}>
							{(i) => (
								<a href={`/newsletter/${i.id}`} class="archive-card" style={{ "margin-bottom": "24px", display: "block" }}>
									<div class="archive-meta">
										<span class="archive-num">Issue {String(i.issueNumber).padStart(2, "0")}</span>
										<span class="archive-date">
											{i.publishedAt ? new Date(i.publishedAt).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : ""}
										</span>
									</div>
									<h3 class="archive-title">{i.title}</h3>
									<span class="archive-link">&#123; READ THE TEARDOWN &#125;</span>
								</a>
							)}
						</For>
					</div>
				</Show>
			</section>

			{/* ════════ CTA BAND ════════ */}
			<div class="dark-band">
				<div class="dark-band-inner">
					<h2 class="dark-band-headline">
						How much is manual work
						<br />
						<em>costing your firm?</em>
					</h2>
					<p class="dark-band-body">
						See where your team wastes the most time and where AI can have the biggest impact.
					</p>
					<a href="/scorecard" class="cta-bracketed cta-hero" style={{ "color": "var(--color-letterpress-black)" }}>
						&#123; TAKE THE AI SCORECARD &#125;
					</a>
				</div>
			</div>

			<Footer />
		</MarketingPage>
	);
}
