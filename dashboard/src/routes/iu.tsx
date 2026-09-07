// IU case study — ported from marketing/src/pages/iu.astro.

import MarketingPage from "~/components/marketing/MarketingPage";
import { Header } from "~/components/marketing/Header";
import { Footer } from "~/components/marketing/Footer";
import "~/styles/marketing-iu.css";

export default function IuCaseStudy() {
	return (
		<MarketingPage
			title="Mad Cactus — IU Case Study"
			description="How we built an autonomous data engineering agent for Indiana University that increased productivity by 45%."
		>
			<Header />

			{/* ════════ HERO ════════ */}
			<div class="case-hero">
				<div class="case-hero-inner">
					<div class="case-hero-left">
						<p class="case-hero-tag">Case Study — Data Engineering</p>
						<h1 class="case-hero-title">
							Indiana
							<br />
							<em>University</em>
						</h1>
					</div>
					<div class="case-hero-right">
						<p>
							IU's data engineering team was drowning in tickets. Senior engineers spent more time triaging than
							building. We deployed an autonomous AI agent that performs intelligent first-pass analysis —
							transforming their resolution pipeline and freeing the team to focus on architecture, not triage.
						</p>
					</div>
				</div>
			</div>

			{/* ════════ STATS ════════ */}
			<div class="stats-bar">
				<div class="stats-bar-inner">
					<div class="stat-item">
						<strong>45%</strong>
						<span>Productivity Increase</span>
					</div>
					<div class="stat-item">
						<strong>MTTR</strong>
						<span>Reduced Significantly</span>
					</div>
					<div class="stat-item">
						<strong>Q2—Q3</strong>
						<span>Measured Impact Period</span>
					</div>
					<div class="stat-item">
						<strong>24/7</strong>
						<span>Agent Uptime</span>
					</div>
				</div>
			</div>

			{/* ════════ THE PROBLEM ════════ */}
			<div class="case-section">
				<div class="case-section-grid">
					<h2 class="case-section-label">
						The
						<br />
						<em>Problem</em>
					</h2>
					<div class="case-section-body">
						<p>
							IU's data engineering team managed a high-throughput ticket queue serving researchers, faculty, and staff
							across the university. As data infrastructure grew, so did the volume and complexity of incoming issues.
						</p>
						<p>
							Senior engineers were spending a disproportionate amount of time on initial triage — reading tickets,
							categorizing issues, identifying root causes, and routing them to the right person. This created a
							bottleneck that slowed resolution times and pulled experienced engineers away from higher-value work.
						</p>
						<h4>Key Challenges</h4>
						<ul>
							<li>High ticket volume with inconsistent categorization</li>
							<li>Senior engineers spending hours on triage instead of engineering</li>
							<li>Long mean time to resolution (MTTR) on common issues</li>
							<li>Knowledge silos — only senior staff could accurately route tickets</li>
							<li>No automated first-pass analysis or prioritization</li>
						</ul>
					</div>
				</div>
			</div>

			{/* ════════ THE SOLUTION ════════ */}
			<div class="case-section">
				<div class="case-section-grid">
					<h2 class="case-section-label">
						The
						<br />
						<em>Solution</em>
					</h2>
					<div class="case-section-body">
						<p>
							We designed and deployed a custom AI agent purpose-built for IU's data engineering workflow. The agent
							integrates directly with their ticketing system and performs an intelligent first-pass analysis on every
							incoming issue.
						</p>
						<p>
							Using their institutional knowledge base and historical ticket data, the agent categorizes issues,
							identifies likely root causes, suggests resolution paths, and routes tickets to the appropriate engineer
							with full context attached.
						</p>
						<h4>Agent Capabilities</h4>
						<ul>
							<li>Automatic ticket categorization and priority scoring</li>
							<li>Root cause analysis based on historical patterns</li>
							<li>Context-rich routing with suggested resolution steps</li>
							<li>Continuous learning from resolution outcomes</li>
							<li>Integration with existing tooling and documentation</li>
						</ul>
					</div>
				</div>
			</div>

			{/* ════════ PROCESS ════════ */}
			<div class="case-section">
				<div class="section-header" style={{ padding: "0", "margin-bottom": "var(--spacing-48)" }}>
					<h2 class="section-title">How We Built It</h2>
					<hr class="section-rule" />
				</div>
				<div class="process-grid">
					<div class="process-step">
						<div class="process-num">01</div>
						<h4>Discovery</h4>
						<p>Deep-dive into IU's ticketing data, workflows, team structure, and pain points.</p>
					</div>
					<div class="process-step">
						<div class="process-num">02</div>
						<h4>Intelligence Layer</h4>
						<p>Built the knowledge base from historical tickets, runbooks, and institutional docs.</p>
					</div>
					<div class="process-step">
						<div class="process-num">03</div>
						<h4>Agent Development</h4>
						<p>Designed and trained the autonomous agent with custom workflows for triage and routing.</p>
					</div>
					<div class="process-step">
						<div class="process-num">04</div>
						<h4>Deployment</h4>
						<p>Rolled out incrementally, measured impact across Q2—Q3, iterated on feedback.</p>
					</div>
				</div>
			</div>

			{/* ════════ QUOTE ════════ */}
			<div class="case-quote">
				<blockquote>
					"The agent handles the first pass on every ticket. My team now <em>focuses on engineering</em>, not inbox
					management."
				</blockquote>
				<cite>Data Engineering Lead, Indiana University</cite>
			</div>

			{/* ════════ RESULTS ════════ */}
			<div class="case-section">
				<div class="case-section-grid">
					<h2 class="case-section-label">
						The
						<br />
						<em>Results</em>
					</h2>
					<div class="case-section-body">
						<p>
							Measured over Q2 and Q3, the agent's impact was immediate and substantial. Overall team productivity
							increased by 45%, driven primarily by the elimination of manual triage and faster routing accuracy.
						</p>
						<p>
							Mean time to resolution dropped significantly as engineers received tickets that were already categorized,
							prioritized, and enriched with likely root causes and suggested fixes.
						</p>
						<h4>Impact Summary</h4>
						<ul>
							<li>45% increase in team productivity across Q2—Q3</li>
							<li>Significant reduction in mean time to resolution (MTTR)</li>
							<li>Senior engineers reclaimed architecture and systems time</li>
							<li>Ticket routing accuracy improved with context-rich handoffs</li>
							<li>Agent accuracy continued to improve through continuous learning</li>
						</ul>
					</div>
				</div>
			</div>

			{/* ════════ CTA ════════ */}
			<div class="case-cta">
				<h2>
					Want this for
					<br />
					<em>your team?</em>
				</h2>
				<p>
					Get a free audit of your business operations. We'll show you exactly where an AI agent can make the biggest
					impact.
				</p>
				<a href="/scorecard" class="cta-bracketed">
					&#123; TAKE THE SCORECARD &#125;
				</a>
				<a href="/" class="back-link">
					Back to Home
				</a>
			</div>

			<Footer />
		</MarketingPage>
	);
}
