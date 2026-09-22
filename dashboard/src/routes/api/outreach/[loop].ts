// LinkedIn sourcing + connect loop — machine endpoints for the Orca browser
// automations (admin mc_ key auth):
//
//   POST /api/outreach/candidates  ← Automation A: scraped ICP candidates land
//                                    as stage=candidate rows (never auto-invited)
//   GET  /api/outreach/invite-queue ← Automation B: approved + uninvited rows
//   POST /api/outreach/invited      ← Automation B: which invites were sent
//
// The human fit review sits between A and B: only icpApproved rows enter the
// queue, and the automation (not this API) enforces the daily invite cap and
// the abort conditions.
import type { APIEvent } from "@solidjs/start/server";
import { and, asc, eq, ilike, inArray, isNull } from "drizzle-orm";
import { db } from "~/db";
import { outreachProspects } from "~/db/schema";
import { isAdminApiKey, json } from "~/lib/admin-api";
import { UUID_RE } from "~/lib/uuid";

export const POST = async (event: APIEvent) => {
	if (!(await isAdminApiKey(event.request))) return json({ error: "Unauthorized" }, 401);
	const url = new URL(event.request.url);

	if (url.pathname.endsWith("/candidates")) {
		const body = (await event.request.json().catch(() => null)) as {
			candidates?: { company?: string; contactName?: string; profileUrl?: string }[];
		} | null;
		const list = (body?.candidates ?? []).filter((c) => c.company?.trim());
		if (!list.length) return json({ error: "candidates[] with company is required" }, 400);
		const sourceNote = `li-search ${new Date().toISOString().slice(0, 10)}`;
		let created = 0;
		let skipped = 0;
		for (const c of list.slice(0, 25)) {
			const company = c.company!.trim();
			const [existing] = await db
				.select({ id: outreachProspects.id })
				.from(outreachProspects)
				.where(ilike(outreachProspects.company, company))
				.limit(1);
			if (existing) {
				skipped++;
				continue;
			}
			await db.insert(outreachProspects).values({
				company,
				contactName: c.contactName?.trim() || null,
				stage: "candidate",
				region: "Midwest",
				notes: c.profileUrl?.trim() ? `li: ${c.profileUrl.trim()}` : null,
				sourceNote,
			});
			created++;
		}
		return json({ created, skipped, sourceNote });
	}

	if (url.pathname.endsWith("/invited")) {
		const body = (await event.request.json().catch(() => null)) as { ids?: string[] } | null;
		const ids = (body?.ids ?? []).filter((id) => UUID_RE.test(id));
		if (!ids.length) return json({ error: "ids[] of prospect rows is required" }, 400);
		// idempotent: only rows still candidate + never-invited can flip — a
		// replayed POST can never double-send or overwrite a later stage
		const updated = await db
			.update(outreachProspects)
			.set({
				stage: "proposed",
				invitedAt: new Date(),
				nextActionAt: new Date(Date.now() + 3 * 86_400_000),
				nextActionNote: "check acceptance, then follow up",
			})
			.where(
				and(
					inArray(outreachProspects.id, ids),
					eq(outreachProspects.stage, "candidate"),
					isNull(outreachProspects.invitedAt),
				),
			)
			.returning({ id: outreachProspects.id, company: outreachProspects.company });
		return json({ invited: updated.length, rows: updated });
	}

	return json({ error: "Unknown endpoint" }, 404);
};

export const GET = async (event: APIEvent) => {
	if (!(await isAdminApiKey(event.request))) return json({ error: "Unauthorized" }, 401);
	const url = new URL(event.request.url);
	if (!url.pathname.endsWith("/invite-queue")) return json({ error: "Unknown endpoint" }, 404);
	// human-approved fit + never invited + still waiting for the invite
	const rows = await db
		.select({
			id: outreachProspects.id,
			company: outreachProspects.company,
			contactName: outreachProspects.contactName,
			notes: outreachProspects.notes,
			sourceNote: outreachProspects.sourceNote,
		})
		.from(outreachProspects)
		.where(
			and(
				eq(outreachProspects.icpApproved, true),
				isNull(outreachProspects.invitedAt),
				eq(outreachProspects.stage, "candidate"),
			),
		)
		.orderBy(asc(outreachProspects.createdAt))
		.limit(25);
	return json({
		queue: rows,
		cap: 5,
		hint: "Send at most cap invites this run. Abort on any CAPTCHA, login wall, or warning banner — report nothing, rows stay in the queue.",
	});
};
