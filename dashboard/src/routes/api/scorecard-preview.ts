import type { APIEvent } from "@solidjs/start/server";
import { generateScorecardPDF } from "./scorecard-pdf";
import type { ScoreData } from "./types";

// Dev-only preview: generates a PDF with sample data and returns it
// directly in the browser. Hit /api/scorecard-preview to see the PDF.
export async function GET() {
	const sampleData: ScoreData = {
		tier: "AI Urgent",
		pct: 78,
		tierDesc:
			"You have substantial waste in your operations. Targeted AI implementation could recover significant capacity without adding headcount.",
		annualCost: 1240000,
		employeeCount: 40,
		wastePct: 31,
		categories: [
			["documents", 3, 3],
			["knowledge", 5, 6],
			["communication", 3, 3],
			["data", 2, 3],
			["reporting", 2, 3],
			["onboarding", 2, 3],
			["capacity", 2, 3],
			["ai", 2, 3],
		],
	};

	const pdf = await generateScorecardPDF(sampleData);

	return new Response(pdf, {
		status: 200,
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": "inline; filename=AI-Readiness-Assessment.pdf",
		},
	});
}
