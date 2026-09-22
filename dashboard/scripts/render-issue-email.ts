// Prerender an issue email to an HTML file — for pasting into Resend's
// template editor / inbox-preview tools to verify rendering before a send.
//
//   bun scripts/render-issue-email.ts                  → sample issue
//   bun scripts/render-issue-email.ts <docId>          → a real draft (from DB)
//   bun scripts/render-issue-email.ts <docId> out.html → custom output path
//
// Output defaults to /tmp/dispatch-email-preview.html. Rendered UNTRACKED
// (static seal, no pixel) — safe to open, share, and upload anywhere.
import { renderIssueEmail, newsletterSubject } from "~/lib/publish-core";
import { db } from "~/db";
import { docs } from "~/db/schema";
import { eq } from "drizzle-orm";

const docId = process.argv[2] ?? "";
const out = process.argv[3] ?? "/tmp/dispatch-email-preview.html";

let html: string;
if (docId) {
	const [doc] = await db.select().from(docs).where(eq(docs.id, docId)).limit(1);
	if (!doc || doc.kind !== "newsletter") {
		console.error(`doc ${docId} not found or not a newsletter`);
		process.exit(1);
	}
	html = renderIssueEmail({
		subject: newsletterSubject(doc),
		markdown: doc.markdown,
		appendix: doc.emailAppendix,
		issueNumber: doc.issueNumber,
	});
	console.log(`rendered: "${doc.title}"`);
} else {
	html = renderIssueEmail({
		subject: "Teardown #7: three agents, forty minutes, one warehouse",
		markdown: [
			"Last week we embedded a three-agent loop into a 12-person distribution company. Here is the whole thing, costs included.",
			"",
			"## The setup",
			"",
			"- One intake agent reading inbound email",
			"- One quote agent drafting responses from their price book",
			"- One review agent flagging anything under 30% margin",
			"",
			"> Prompt used for the review agent: flag any quote where labor hours exceed the rolling 30-day average for that SKU.",
			"",
			"## What it cost",
			"",
			"About $240/mo in model calls and two days of build time. The team caught 11 pricing mistakes in the first week.",
		].join("\n"),
		appendix:
			"P.S. Want to start turning your company AI-native? I build a custom company brain for one reader every week, completely free. All you have to do is click below. [**{ GET YOUR COMPANY BRAIN }**](https://madcactus.org/brain)",
	});
	console.log("rendered: sample issue");
}

await Bun.write(out, html);
console.log(`written to ${out} — paste into Resend's template editor or open in a browser`);
