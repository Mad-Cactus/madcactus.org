// /brain — the ONE lead magnet: "answer a few questions about your company,
// we build you a custom company brain, free." Replaces the AI scorecard
// (/scorecard 302s here). Qualification is front-loaded — but no revenue
// (nobody self-reports it; we research it) and no "what would you ask your
// brain" (they don't know yet).
import { onMount } from "solid-js";
import MarketingPage from "~/components/marketing/MarketingPage";
import { Header } from "~/components/marketing/Header";
import { Footer } from "~/components/marketing/Footer";
import "~/styles/marketing-shared.css";

const label = "display:block;font-family:var(--font-serif);font-size:15px;margin:18px 0 6px;";
const input =
	"width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cfc9bb;background:#fff;font-family:var(--font-serif);font-size:15px;color:#1a1a1a;border-radius:4px;";
const row = "display:grid;grid-template-columns:1fr 1fr;gap:16px;";

export default function BrainLanding() {
	let ref = "";
	onMount(() => {
		// issue attribution — the issue CTAs link here with ?ref=<docId>
		ref = new URLSearchParams(window.location.search).get("ref") ?? "";
	});

	const submit = async (e: SubmitEvent) => {
		e.preventDefault();
		const form = e.currentTarget as HTMLFormElement;
		const btn = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
		const data = Object.fromEntries(new FormData(form).entries());
		btn.disabled = true;
		btn.textContent = "{ SENDING }";
		const res = await fetch("/api/brain-request", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...data, ref }),
		});
		if (res.ok) {
			form.innerHTML =
				'<p style="font-family:var(--font-serif);font-size:18px;line-height:1.6;">You\'re in. I\'ll read your answers, research your company, and reply within a couple of days with your brain. — Collin</p>';
		} else {
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			btn.disabled = false;
			btn.textContent = "{ BUILD MY BRAIN }";
			const err = form.querySelector<HTMLParagraphElement>(".brain-error");
			if (err) err.textContent = body.error ?? "Something broke — try again.";
		}
	};

	return (
		<MarketingPage
			title="Get a Free Custom Company Brain | Mad Cactus"
			description="Answer a few questions about your company. We build you a custom company brain, free, so you can see what AI actually does for your business."
		>
			<Header />
			<section style={{ "max-width": "680px", margin: "0 auto", padding: "48px 24px 96px" }}>
				<h1 style={{ "font-family": "var(--font-serif)", "font-size": "42px", "line-height": 1.15, margin: "0 0 12px" }}>
					We'll build your company a <em>brain</em>. Free.
				</h1>
				<p style={{ "font-family": "var(--font-serif)", "font-size": "18px", "line-height": 1.6, margin: "0 0 8px" }}>
					Answer a few questions about your company below. We build you a custom company brain: your data, docs, and
					institutional knowledge, unified so agents can actually reason over it.
				</p>
				<p style={{ "font-family": "var(--font-serif)", "font-size": "16px", "line-height": 1.6, "font-style": "italic", margin: "0 0 32px" }}>
					I build one company brain every week, in the order requests arrive. You see what it does before you pay for anything.
				</p>
				<form onSubmit={submit}>
					{/* honeypot — hidden from humans, bots fill it and get a silent ok */}
					<div style={{ position: "absolute", left: "-9999px" }} aria-hidden="true">
						<label for="website">Website</label>
						<input id="website" name="website" type="text" tabindex={-1} autocomplete="off" />
					</div>
					<div class={row}>
						<div>
							<label for="brain-name" style={label}>Full name *</label>
							<input id="brain-name" name="name" type="text" required style={input} autocomplete="name" />
						</div>
						<div>
							<label for="brain-email" style={label}>Work email *</label>
							<input id="brain-email" name="email" type="email" required style={input} autocomplete="email" spellcheck={false} />
						</div>
						<div>
							<label for="brain-title" style={label}>Job title</label>
							<input id="brain-title" name="jobTitle" type="text" style={input} autocomplete="organization-title" />
						</div>
						<div>
							<label for="brain-company" style={label}>Company name *</label>
							<input id="brain-company" name="company" type="text" required style={input} autocomplete="organization" />
						</div>
						<div>
							<label for="brain-industry" style={label}>Industry</label>
							<input id="brain-industry" name="industry" type="text" style={input} />
						</div>
						<div>
							<label for="brain-headcount" style={label}>Company size</label>
							<select id="brain-headcount" name="headcount" style={input}>
								<option value="">Select…</option>
								<option>Just me</option>
								<option>2–5</option>
								<option>6–10</option>
								<option>11–25</option>
								<option>26–50</option>
								<option>50+</option>
							</select>
						</div>
					</div>
					<label for="brain-what" style={label}>What does your company do?</label>
					<textarea id="brain-what" name="whatTheyDo" rows={2} style={input} />
					<label for="brain-tech" style={label}>How big is your technical team?</label>
					<select id="brain-tech" name="techTeam" style={input}>
						<option value="">Select…</option>
						<option>None</option>
						<option>1–3</option>
						<option>4–10</option>
						<option>10+</option>
					</select>
					<label for="brain-stack" style={label}>
						What does your company run on day to day — and does it use AI for anything today?
					</label>
					<textarea id="brain-stack" name="stackAndAi" rows={3} style={input} />
					<label for="brain-bottleneck" style={label}>What's the biggest bottleneck in the business right now?</label>
					<textarea id="brain-bottleneck" name="bottleneck" rows={3} style={input} />
					<label for="brain-heard" style={label}>How did you hear about us?</label>
					<select id="brain-heard" name="heardAbout" style={input}>
						<option value="">Select…</option>
						<option>LinkedIn post</option>
						<option>The Cactus Dispatch newsletter</option>
						<option>Referral</option>
						<option>Other</option>
					</select>
					<p class="brain-error" style={{ color: "#a33", "font-family": "var(--font-serif)", "font-size": "14px", "min-height": "20px", margin: "12px 0 0" }} role="alert" />
					<button
						type="submit"
						class="cta-bracketed"
						style={{ "margin-top": "24px", border: "none", cursor: "pointer", "font-size": "16px" }}
					>
						&#123; BUILD MY BRAIN &#125;
					</button>
				</form>
			</section>
			<Footer />
		</MarketingPage>
	);
}
