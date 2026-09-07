// AI Readiness Scorecard — ported from marketing/src/pages/scorecard.astro.
// Quiz logic is the original vanilla-DOM script in onMount; ids preserved.

import { onMount } from "solid-js";
import MarketingPage from "~/components/marketing/MarketingPage";
import { Header } from "~/components/marketing/Header";
import { Footer } from "~/components/marketing/Footer";
import { subscribeToNewsletter } from "~/components/marketing/subscribe";
import "~/styles/marketing-scorecard.css";

const QUESTIONS: { category: string; q: number; text: string; answers: [value: number, label: string][] }[] = [
	{
		category: "documents",
		q: 1,
		text: "When your team writes a proposal, report, or contract, what's the starting point?",
		answers: [
			[3, "From scratch every time"],
			[2, "We have templates but still manually edit most of it"],
			[1, "Mostly automated or generated from a system"],
		],
	},
	{
		category: "data",
		q: 2,
		text: "How much time does your team spend moving data between systems?",
		answers: [
			[3, "A lot, every day"],
			[2, "A few times per week"],
			[1, "Minimal, most systems are integrated"],
		],
	},
	{
		category: "knowledge",
		q: 3,
		text: "When someone needs to find internal information, what happens?",
		answers: [
			[3, "They dig through email, Slack, and shared folders"],
			[2, "Some docs exist but they're scattered"],
			[1, "Centralized, searchable knowledge base"],
		],
	},
	{
		category: "reporting",
		q: 4,
		text: "How do you put together client or leadership reports?",
		answers: [
			[3, "Manually pulling data from multiple sources into spreadsheets"],
			[2, "Some automation, but still requires manual assembly"],
			[1, "Automated dashboards that update themselves"],
		],
	},
	{
		category: "communication",
		q: 5,
		text: "How does your team handle repetitive client communications?",
		answers: [
			[3, "Each person responds individually, every time"],
			[2, "Some canned responses, but manual sending"],
			[1, "Automated or AI-assisted responses"],
		],
	},
	{
		category: "knowledge",
		q: 6,
		text: "When a key employee leaves, what happens to their knowledge?",
		answers: [
			[3, "It walks out the door with them"],
			[2, "Partial documentation, some gaps"],
			[1, "Well-documented processes, smooth handoff"],
		],
	},
	{
		category: "onboarding",
		q: 7,
		text: "How long does new client or project onboarding take?",
		answers: [
			[3, "Weeks of manual setup and configuration"],
			[2, "A few days with some manual steps"],
			[1, "Mostly templated or automated"],
		],
	},
	{
		category: "capacity",
		q: 8,
		text: "How stretched is your team right now?",
		answers: [
			[3, "Overwhelmed, turning away work or missing deadlines"],
			[2, "Managing, but stretched thin"],
			[1, "Comfortable, room to take on more"],
		],
	},
	{
		category: "ai",
		q: 9,
		text: "How does your team currently use AI tools?",
		answers: [
			[3, "Barely, a few people experimenting on their own"],
			[2, "Some adoption, but no coordinated strategy"],
			[1, "Integrated into workflows with a clear strategy"],
		],
	},
	{
		category: "sizing",
		q: 10,
		text: "How many employees does your firm have?",
		answers: [
			[5, "Under 10"],
			[20, "10 to 25"],
			[40, "25 to 50"],
			[75, "50+"],
		],
	},
];

type ScoreData = {
	tier: string;
	pct: number;
	tierDesc: string;
	annualCost: number;
	employeeCount: number;
	wastePct: number;
	categories: [string, number, number][];
};

export default function Scorecard() {
	onMount(() => {
		const totalQ = QUESTIONS.length;
		let currentQ = 0;
		let lastScoreData: ScoreData | null = null;

		const questionEls = Array.from(document.querySelectorAll<HTMLElement>(".question"));
		const progressFill = document.getElementById("scProgressFill")!;
		const progressText = document.getElementById("progressText")!;
		const prevBtn = document.getElementById("prevBtn") as HTMLButtonElement;
		const nextBtn = document.getElementById("nextBtn") as HTMLButtonElement;
		const form = document.getElementById("scorecardForm") as HTMLFormElement;
		const results = document.getElementById("results")!;
		const quiz = document.getElementById("quiz")!;

		function updateUI() {
			questionEls.forEach((q, i) => q.classList.toggle("active", i === currentQ));
			progressFill.style.width = `${((currentQ + 1) / totalQ) * 100}%`;
			progressText.textContent = `Question ${currentQ + 1} of ${totalQ}`;
			prevBtn.style.visibility = currentQ === 0 ? "hidden" : "visible";
			nextBtn.textContent = currentQ === totalQ - 1 ? "Get My Score" : "Next";
		}

		function isAnswered() {
			const name = questionEls[currentQ].dataset.q;
			return form.querySelector(`input[name="q${name}"]:checked`) !== null;
		}

		nextBtn.addEventListener("click", () => {
			if (!isAnswered()) return;
			if (currentQ < totalQ - 1) {
				currentQ++;
				updateUI();
			} else {
				calculateScore();
			}
		});

		prevBtn.addEventListener("click", () => {
			if (currentQ > 0) {
				currentQ--;
				updateUI();
			}
		});

		// auto-advance on selection
		for (const q of questionEls) {
			for (const input of q.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
				input.addEventListener("change", () => {
					setTimeout(() => {
						if (currentQ < totalQ - 1 && isAnswered()) {
							currentQ++;
							updateUI();
						}
					}, 250);
				});
			}
		}

		function calculateScore() {
			let total = 0;
			let employeeCount = 20;
			const categories: Record<string, number> = {};

			for (let i = 1; i <= totalQ; i++) {
				const checked = form.querySelector<HTMLInputElement>(`input[name="q${i}"]:checked`);
				if (!checked) continue;
				const val = parseInt(checked.value);
				const cat = QUESTIONS[i - 1].category;
				if (cat === "sizing") {
					employeeCount = val;
				} else {
					categories[cat] = (categories[cat] ?? 0) + val;
					total += val;
				}
			}

			const maxScore = 9 * 3; // 9 scored questions, max 3 each
			const pct = Math.round((total / maxScore) * 100);
			let tier: string, tierDesc: string, tierColor: string;

			if (pct >= 80) {
				tier = "AI Critical";
				tierDesc =
					"Your firm is losing significant time and money to manual processes every day. The good news: this means the ROI of fixing it will be massive.";
				tierColor = "#c0392b";
			} else if (pct >= 55) {
				tier = "AI Urgent";
				tierDesc =
					"You have substantial waste in your operations. Targeted AI implementation could recover significant capacity without adding headcount.";
				tierColor = "#bc9c5c";
			} else if (pct >= 30) {
				tier = "AI Ready";
				tierDesc = "You have a solid foundation with clear opportunities for improvement. Quick wins are available in specific areas.";
				tierColor = "#2c3e50";
			} else {
				tier = "AI Mature";
				tierDesc = "Your operations are well-optimized. AI can still add value through advanced automation and competitive differentiation.";
				tierColor = "#27ae60";
			}

			// cost estimate: avg fully-loaded salary $100k, waste = pct of time
			const avgSalary = 100000;
			const estimatedWastePct = (pct / 100) * 0.4;
			const annualCost = Math.round((employeeCount * avgSalary * estimatedWastePct) / 1000) * 1000;

			const catLabels: Record<string, string> = {
				documents: "Document Creation",
				data: "Data Movement",
				knowledge: "Knowledge Management",
				reporting: "Reporting & Analytics",
				communication: "Client Communication",
				onboarding: "Onboarding",
				capacity: "Team Capacity",
				ai: "AI Adoption",
			};

			const sortedCats = Object.entries(categories).sort((a, b) => b[1] - a[1]);

			const scoreDisplay = document.getElementById("scoreDisplay")!;
			scoreDisplay.innerHTML = `
				<div class="score-tier" style="color: ${tierColor}">${tier}</div>
				<div class="score-number">${pct}<span class="score-pct">%</span></div>
				<div class="score-desc">${tierDesc}</div>
				<div class="score-cost">
					<span class="cost-label">Estimated annual cost of manual work</span>
					<span class="cost-amount">$${annualCost.toLocaleString()}</span>
					<span class="cost-note">Based on ${employeeCount} employees at ~${Math.round(estimatedWastePct * 100)}% time wasted on manual tasks</span>
				</div>
			`;

			const breakdown = document.getElementById("scoreBreakdown")!;
			breakdown.innerHTML = `
				<h3 class="breakdown-title">Where your firm is bleeding time</h3>
				<div class="breakdown-bars">
					${sortedCats
						.map(([cat, score]) => {
							const max = cat === "knowledge" ? 6 : 3; // knowledge has 2 questions
							const catPct = Math.round((score / max) * 100);
							return `
								<div class="breakdown-row">
									<span class="breakdown-label">${catLabels[cat]}</span>
									<div class="breakdown-bar"><div class="breakdown-fill" style="width: ${catPct}%"></div></div>
									<span class="breakdown-score">${catPct}%</span>
								</div>
							`;
						})
						.join("")}
				</div>
				<p class="breakdown-note">Highest scores indicate the areas where AI automation would deliver the fastest return on investment.</p>
			`;

			lastScoreData = {
				tier,
				pct,
				tierDesc,
				annualCost,
				employeeCount,
				wastePct: Math.round(estimatedWastePct * 100),
				categories: sortedCats.map(([cat, score]) => [cat, score, cat === "knowledge" ? 6 : 3]),
			};

			quiz.style.display = "none";
			results.style.display = "block";
			results.scrollIntoView({ behavior: "smooth" });
			window.posthog?.capture("scorecard_complete", { score: pct });
		}

		// email gate — PDF report via the same /api/newsletter endpoint
		const emailForm = document.getElementById("emailForm") as HTMLFormElement | null;
		if (emailForm) {
			emailForm.addEventListener("submit", async (e) => {
				e.preventDefault();
				const email = emailForm.email.value.trim();
				const btn = emailForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
				const gate = document.getElementById("emailGate")!;
				btn.textContent = "Generating PDF...";
				btn.disabled = true;
				const res = await subscribeToNewsletter(email, lastScoreData);
				if (res.ok) {
					gate.innerHTML = `
						<h3 class="gate-heading">Check your inbox</h3>
						<p class="gate-body">Your personalized AI Readiness Assessment PDF is on its way.</p>
					`;
				} else {
					gate.innerHTML = `
						<h3 class="gate-heading">Something went wrong</h3>
						<p class="gate-body">We couldn't send the PDF. Try again or email us directly at cpfeifer@madcactus.org.</p>
					`;
				}
			});
		}

		updateUI();
	});

	return (
		<MarketingPage
			title="AI Readiness Scorecard — Mad Cactus"
			description="A 5-minute assessment that reveals where your firm is bleeding time and labor to manual processes — and where AI can fix it."
		>
			<Header />

			{/* ════════ INTRO ════════ */}
			<section class="intro">
				<div class="intro-inner">
					<h1 class="intro-headline">
						How much is manual work
						<br />
						<em>costing your firm?</em>
					</h1>
					<p class="intro-body">
						Answer ten questions about your operations. Get a personalized score showing where your team wastes the most
						time, the estimated annual cost, and where AI can have the biggest impact.
					</p>
				</div>
			</section>

			{/* ════════ QUIZ ════════ */}
			<section class="quiz" id="quiz">
				<div class="quiz-inner">
					<div class="sc-progress-track">
						<div class="sc-progress-fill" id="scProgressFill" />
					</div>
					<p class="progress-text" id="progressText">
						Question 1 of 10
					</p>

					<form id="scorecardForm">
						{QUESTIONS.map((q) => (
							<div class="question" classList={{ active: q.q === 1 }} data-category={q.category} data-q={q.q}>
								<h2 class="question-text">{q.text}</h2>
								<div class="answers">
									{q.answers.map(([value, label]) => (
										<label>
											<input type="radio" name={`q${q.q}`} value={value} />
											<span>{label}</span>
										</label>
									))}
								</div>
							</div>
						))}
					</form>

					<div class="quiz-nav">
						<button type="button" class="nav-btn" id="prevBtn" style={{ visibility: "hidden" }}>
							Previous
						</button>
						<button type="button" class="nav-btn nav-btn-primary" id="nextBtn">
							Next
						</button>
					</div>
				</div>
			</section>

			{/* ════════ RESULTS ════════ */}
			<section class="results" id="results" style={{ display: "none" }}>
				<div class="results-inner">
					<h2 class="section-title">Your Results</h2>
					<hr class="section-rule" />

					<div class="score-display" id="scoreDisplay" />

					<div class="score-breakdown" id="scoreBreakdown" />

					<div class="email-gate" id="emailGate">
						<h3 class="gate-heading">Get the full breakdown as a PDF</h3>
						<p class="gate-body">
							Enter your email and we'll send a detailed breakdown of each category, how each one could be streamlined in a
							typical firm, and where AI moves the needle most.
						</p>
						<form class="gate-form" id="emailForm">
							<input type="email" name="email" placeholder="your@email.com" required />
							<button type="submit" class="cta-bracketed gate-submit" data-ph-event="scorecard_email_submit">
								&#123; SEND ME THE PDF &#125;
							</button>
						</form>
					</div>

					<div class="results-cta">
						<h3 class="cta-heading">
							Want this customized
							<br />
							for your company?
						</h3>
						<p class="cta-body">
							Book a free audit. We'll map your specific workflows and give you a concrete 90-day plan to go from where you
							are now to AI-native operations.
						</p>
						<a href="https://cal.com/cpfeifer/info-meeting" target="_blank" class="cta-bracketed">
							&#123; BOOK A FREE AUDIT &#125;
						</a>
					</div>
				</div>
			</section>

			<Footer />
		</MarketingPage>
	);
}
