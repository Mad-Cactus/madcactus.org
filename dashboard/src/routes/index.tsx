// Marketing homepage — ported from marketing/src/pages/index.astro.

import { onMount } from "solid-js";
import MarketingPage from "~/components/marketing/MarketingPage";
import { Header } from "~/components/marketing/Header";
import { Footer } from "~/components/marketing/Footer";
import { subscribeToNewsletter } from "~/components/marketing/subscribe";
import "~/styles/marketing-index.css";

export default function Home() {
	onMount(() => {
		const bandForm = document.getElementById("newsletterBandForm") as HTMLFormElement | null;
		if (!bandForm) return;
		bandForm.addEventListener("submit", async (e) => {
			e.preventDefault();
			const email = bandForm.email.value.trim();
			const btn = bandForm.querySelector("button")!;
			btn.textContent = "Subscribing...";
			btn.disabled = true;
			const res = await subscribeToNewsletter(email);
			if (res.ok) {
				bandForm.innerHTML =
					'<p style="font-family: var(--font-serif); font-style: italic; font-size: var(--text-body-sm);">You\'re in. Check your inbox.</p>';
			} else {
				btn.textContent = "{ SUBSCRIBE }";
				btn.disabled = false;
			}
		});
	});
	return (
		<MarketingPage
			title="Mad Cactus — Turn Your Business AI-Native"
			description="We build the intelligence layer, custom agents, and workflows that make AI actually work for your business."
		>
			<Header />

			{/* ════════ HERO ════════ */}
			<section class="hero">
				<div class="hero-inner">
					<div class="hero-text">
						<h1 class="hero-headline">
							Turn Your<br />
							Business<br />
							<em>AI-Native.</em>
						</h1>
						<p class="hero-body">
							We build the intelligence layer, custom agents, and workflows that make AI actually work for your business.
							Letting your team of five operate like a team of twenty-five.
						</p>
						{/* ponytail: plain img — Astro's responsive widths dropped; swap to <picture>/srcset if LCP suffers */}
						<a href="/scorecard" class="cta-bracketed cta-hero" data-ph-event="cta_scorecard">
							&#123; TAKE THE AI SCORECARD &#125;
						</a>
					</div>
					<div class="hero-plate">
						<img src="/cactus-in-bloom.jpg" alt="Cactus in bloom" />
					</div>
				</div>
			</section>

			{/* ════════ SERVICES ════════ */}
			<section id="services">
				<div class="section-header">
					<h2 class="section-title">Our Method</h2>
					<hr class="section-rule" />
				</div>
				<div class="services-grid">
					<div class="service-col">
						<div class="service-num">01</div>
						<h3>Business Audit</h3>
						<p>
							Our agent books meetings with you and every one of your employees to learn about each workflow, the
							dependencies, and how everyone does their job. This gives insights into how your business generates
							value and reveals what workflows can be augmented by AI.
						</p>
					</div>
					<div class="service-col">
						<div class="service-num">02</div>
						<h3>Intelligence Layer</h3>
						<p>
							Your company's brain. Unify your data, docs, and institutional knowledge into a single intelligence
							layer that agents can reason over in real time — across Slack, Google Drive, Box, Teams, and every
							meeting, customer interaction, and sale.
						</p>
					</div>
					<div class="service-col">
						<div class="service-num">03</div>
						<h3>Agent Development</h3>
						<p>
							We build custom agents that automate and augment your workflows, allowing your team to hand off entire
							tasks to AI and spend more time on what matters most. Allowing your business to grow faster than ever
							before.
						</p>
					</div>
				</div>
			</section>

			{/* ════════ DARK BAND — PHILOSOPHY ════════ */}
			<div class="dark-band">
				<div class="dark-band-inner">
					<h2 class="dark-band-headline">
						If you can't hand off tasks
						<br />
						to agents, <em>you don't pay.</em>
					</h2>
					<p class="dark-band-body">
						We don't sell hours or piecemeal tools. We embed with your team, audit your operations, build your AI
						intelligence layer, deploy custom agents, and train your people to run them. The work speaks for itself.
					</p>
				</div>
			</div>

			{/* ════════ NEWSLETTER BAND ════════ */}
			<section id="newsletter-band">
				<div class="newsletter-band-inner">
					<div class="newsletter-band-text">
						<h3 class="newsletter-band-heading">
							AI teardowns <em>from real clients.</em>
						</h3>
						<p class="newsletter-band-body">
							Weekly breakdowns of real AI deployments. What we built, what it cost, and the blueprint to do the same.
						</p>
					</div>
					<form class="newsletter-band-form" id="newsletterBandForm">
						<input type="email" name="email" placeholder="your@email.com" required autocomplete="email" />
						<button type="submit" class="cta-bracketed" data-ph-event="newsletter_signup_home">
							&#123; SUBSCRIBE &#125;
						</button>
					</form>
				</div>
			</section>

			{/* ════════ CASE STUDY ════════ */}
			<section id="case-studies">
				<div class="section-header">
					<h2 class="section-title">Proven in Production</h2>
					<hr class="section-rule" />
				</div>
				<a href="/iu" class="case-study-card" data-ph-event="case_study_click">
					<div class="case-study-visual">
						<span class="case-study-institution">
							INDIANA
							<br />
							<em>UNIVERSITY</em>
						</span>
						<span class="case-study-sector">Data Engineering</span>
					</div>
					<div class="case-study-content">
						<h3 class="case-study-title">Autonomous data engineering agent that transformed IU's ticket resolution pipeline.</h3>
						<p class="case-study-desc">
							A custom AI agent performing intelligent first-pass analysis on incoming data engineering tickets.
							Triaging issues, identifying root causes, and routing with context.
						</p>
						<div class="case-study-stats">
							<div class="stat">
								<strong>45%</strong>
								<span>Productivity Increase</span>
							</div>
							<div class="stat">
								<strong>MTTR</strong>
								<span>Significantly Reduced</span>
							</div>
							<div class="stat">
								<strong>Q2-Q3</strong>
								<span>Measured Impact</span>
							</div>
						</div>
						<span class="case-study-link cta-bracketed">&#123; READ FULL CASE STUDY &#125;</span>
					</div>
				</a>
			</section>

			{/* ════════ SCORECARD CTA ════════ */}
			<section class="lead-section">
				<div class="lead-inner">
					<div class="lead-left">
						<h3 class="lead-heading">
							How much is manual work
							<br />
							<em>costing your firm?</em>
						</h3>
					</div>
					<div class="lead-right">
						<p>
							Take our free AI Readiness Scorecard. In five minutes, you'll see exactly where your team wastes the
							most time, the estimated annual cost, and where AI can have the biggest impact.
						</p>
						<a href="/scorecard" class="cta-bracketed" data-ph-event="cta_scorecard">
							&#123; TAKE THE AI SCORECARD &#125;
						</a>
					</div>
				</div>
			</section>

			<Footer />
		</MarketingPage>
	);
}
