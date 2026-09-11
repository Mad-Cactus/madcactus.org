import type { APIEvent } from "@solidjs/start/server";
import { Resend } from "resend";
import { generateScorecardPDF } from "./scorecard-pdf";
import type { ScoreData } from "./types";
import { toBase64 } from "~/lib/crypto";

export async function OPTIONS() {
	return new Response(null, {
		status: 204,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
		},
	});
}

export async function POST(event: APIEvent) {
	const key = process.env.RESEND_API_KEY;
	if (!key) {
		return json({ error: "RESEND_API_KEY not configured" }, 500);
	}

	const body = await event.request.json().catch(() => ({}));
	const email = body?.email?.trim()?.toLowerCase();

	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return json({ error: "Valid email required" }, 400);
	}

	const scoreData: ScoreData | undefined = body?.scoreData;

	const resend = new Resend(key);

	// Segment membership (Resend dashboard → Segments). Missing segment env =
	// contact still created globally, just unsorted. NOTE: no `properties` here —
	// Resend rejects unknown properties with 422 and contact creation fails whole.
	const segmentId = process.env.RESEND_SEGMENT_ID;
	await resend.contacts
		.create({
			email,
			unsubscribed: false,
			...(segmentId ? { segments: [{ id: segmentId }] } : {}),
		})
		.catch((e) => console.error("[newsletter] contact create failed:", e));

	// Newsletter signup → plain-text welcome (no scorecard PDF involved).
	// Plain text on purpose: lands in the primary inbox and builds deliverability
	// before the first HTML issue. Best-effort — never blocks the signup response.
	if (!scoreData) {
		resend.emails
			.send({
				from: "Collin Pfeifer <dispatch@madcactus.org>",
				to: [email],
				subject: "The Cactus Dispatch",
				text:
					`You just got added to The Cactus Dispatch.\n\n` +
					`Every week I tear down a real AI deployment: what we built, what broke, and the copy-paste prompt so you can do the same.\n\n` +
					`New issues land Tuesday morning. Read the last one:\n` +
					`madcactus.org/newsletter\n\n` +
					`P.S. Hit reply and tell me what you're trying to automate. I read and answer every response.\n\n` +
					`Collin`,
			})
			.catch((e) => console.error("[newsletter] welcome email failed:", e));
	}

	// If score data present, generate personalized PDF and email it
	if (scoreData) {
		try {
			const pdfBuffer = await generateScorecardPDF(scoreData);

			await resend.emails.send({
				from: "Mad Cactus <dispatch@madcactus.org>",
				to: [email],
				subject: `Your AI Readiness Score: ${scoreData.pct}% (${scoreData.tier})`,
				html: `
					<div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; color: #0a0a0a;">
						<p>Here's your personalized AI Readiness Assessment.</p>
						<p>Your score: <strong>${scoreData.pct}% — ${scoreData.tier}</strong></p>
						<p>The attached PDF breaks down each category, what it's costing you, and specific steps to fix each area.</p>
						<p>If you want this customized for your company with a concrete 90-day plan, <a href="https://cal.com/cpfeifer/info-meeting">book a free audit</a>.</p>
						<p>— Collin</p>
					</div>
				`,
				attachments: [
					{
						filename: "AI-Readiness-Assessment.pdf",
						content: toBase64(pdfBuffer), // resend accepts base64 strings
					},
				],
			});
		} catch {
			// PDF generation failed — still subscribed them
			return json({ ok: true, message: "subscribed_pdf_failed" });
		}
	}

	return json({ ok: true });
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
		},
	});
}
