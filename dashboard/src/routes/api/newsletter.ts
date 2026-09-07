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

	// Segment membership + source provenance (Resend dashboard → Segments).
	// Missing segment env = contact still created globally, just unsorted.
	const segmentId = process.env.RESEND_SEGMENT_ID;
	await resend.contacts.create({
		email,
		unsubscribed: false,
		...(segmentId ? { segments: [{ id: segmentId }] } : {}),
		properties: { source: scoreData ? "scorecard" : "newsletter" },
	}).catch(() => {});

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
