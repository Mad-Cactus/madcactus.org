import { query, action, redirect } from "@solidjs/router";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";
import { getAuthedClient } from "./session";
import { supabaseService } from "./supabase";
import { db } from "~/db";
import {
	companies,
	clientMembers,
	clientCompanyMembers,
	projects,
	documents,
	invoices,
	deliverables,
	deliverableUpdates,
} from "~/db/schema";
import type {
	DocumentType,
	InvoiceStatus,
	DeliverableStatus,
} from "~/db/schema";

// ── Auth guard ────────────────────────────────────────────────────

async function requireAdmin() {
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
}

// ── Companies ─────────────────────────────────────────────────────

export const getCompaniesQuery = query(async () => {
	"use server";
	await requireAdmin();
	return db.select().from(companies).orderBy(desc(companies.createdAt));
}, "admin-companies");

export const createCompanyAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	await db.insert(companies).values({
		name: String(formData.get("name")),
	});
	throw redirect("/admin/companies");
}, "createCompany");

// ── Members ───────────────────────────────────────────────────────

export const getMembersQuery = query(async () => {
	"use server";
	await requireAdmin();
	return db.select().from(clientMembers).orderBy(desc(clientMembers.createdAt));
}, "admin-members");

export const getCompanyMembersQuery = query(async (companyId: string) => {
	"use server";
	await requireAdmin();
	return db
		.select({
			...getTableColumns(clientMembers),
		})
		.from(clientCompanyMembers)
		.innerJoin(
			clientMembers,
			eq(clientMembers.id, clientCompanyMembers.memberId),
		)
		.where(eq(clientCompanyMembers.companyId, companyId));
}, "admin-company-members");

export const createMemberAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const companyId = String(formData.get("company_id"));
	const email = String(formData.get("email")).toLowerCase();
	const name = String(formData.get("name"));

	const [member] = await db.insert(clientMembers).values({ name, email }).returning();

	// Link member to the company first so the row is fully usable regardless of
	// whether the invite email sends on the first try.
	await db
		.insert(clientCompanyMembers)
		.values({ memberId: member.id, companyId })
		.onConflictDoNothing();

	// Supabase sends the invite email; the client sets their own password.
	const redirectTo = inviteRedirect();
	const { error } = await supabaseService().auth.admin.inviteUserByEmail(email, {
		data: { name },
		...(redirectTo ? { redirectTo } : {}),
	});
	if (error)
		return { error: `Member created, but the invite email failed: ${error.message}` };

	return { success: `Member created. Invite sent to ${email}.` };
}, "createMember");

export const linkMemberAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const memberId = String(formData.get("member_id"));
	const companyId = String(formData.get("company_id"));
	await db
		.insert(clientCompanyMembers)
		.values({ memberId, companyId })
		.onConflictDoNothing();
	throw redirect(`/admin/companies/${companyId}`);
}, "linkMember");

export const unlinkMemberAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const memberId = String(formData.get("member_id"));
	const companyId = String(formData.get("company_id"));
	await db
		.delete(clientCompanyMembers)
		.where(
			and(
				eq(clientCompanyMembers.memberId, memberId),
				eq(clientCompanyMembers.companyId, companyId),
			),
		);
	throw redirect(`/admin/companies/${companyId}`);
}, "unlinkMember");

/** Redirect URL for Supabase invite/reset links (must be allowlisted in Supabase Auth settings). */
function inviteRedirect(): string | null {
	const site = process.env.PUBLIC_SITE_URL;
	return site ? `${site.replace(/\/$/, "")}/portal/login` : null;
}

export const resendInviteAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const id = String(formData.get("id"));
	const [member] = await db
		.select({ email: clientMembers.email })
		.from(clientMembers)
		.where(eq(clientMembers.id, id))
		.limit(1);
	if (!member) return { error: "Member not found" };

	const redirectTo = inviteRedirect();
	const { error } = await supabaseService().auth.admin.inviteUserByEmail(
		member.email,
		{ ...(redirectTo ? { redirectTo } : {}) },
	);
	if (error) return { error: error.message };
	return { success: "Invite re-sent." };
}, "resendInvite");

export const toggleMemberActiveAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const id = String(formData.get("id"));
	const isActive = formData.get("is_active") === "true";
	await db
		.update(clientMembers)
		.set({ isActive: !isActive })
		.where(eq(clientMembers.id, id));
	throw redirect("/admin/companies");
}, "toggleMemberActive");

// ── Projects (for select dropdowns) ───────────────────────────────

export const getProjectsForSelectQuery = query(async () => {
	"use server";
	await requireAdmin();
	return db
		.select({
			id: projects.id,
			name: projects.name,
			companyId: projects.companyId,
			companyName: companies.name,
		})
		.from(projects)
		.innerJoin(companies, eq(companies.id, projects.companyId))
		.orderBy(projects.name);
}, "admin-projects-select");

export const getCompaniesForSelectQuery = query(async () => {
	"use server";
	await requireAdmin();
	return db.select().from(companies).orderBy(companies.name);
}, "admin-companies-select");

// ── Documents ─────────────────────────────────────────────────────

export const getDocumentsQuery = query(async (projectId: string) => {
	"use server";
	await requireAdmin();
	return db
		.select()
		.from(documents)
		.where(eq(documents.projectId, projectId))
		.orderBy(desc(documents.createdAt));
}, "admin-documents");

export const createDocumentLinkAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	await db.insert(documents).values({
		projectId: String(formData.get("project_id")),
		type: String(formData.get("type") || "link") as DocumentType,
		title: String(formData.get("title")),
		url: String(formData.get("url")),
		description: String(formData.get("description") || ""),
		content: String(formData.get("content") || "") || null,
		visibility: "client",
	});
	const ref = formData.get("_referer");
	throw redirect(ref ? String(ref) : "/admin/companies");
}, "createDocumentLink");

export const deleteDocumentAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const id = String(formData.get("id"));
	const storagePath = String(formData.get("storage_path") || "");
	const audioPath = String(formData.get("audio_path") || "");
	const paths = [storagePath, audioPath].filter(Boolean);
	try {
		if (paths.length) {
			const svc = supabaseService();
			await svc.storage.from("portal-docs").remove(paths);
		}
		await db.delete(documents).where(eq(documents.id, id));
		return { success: "Document deleted." };
	} catch (e) {
		return { error: e instanceof Error ? e.message : "Failed to delete document." };
	}
}, "deleteDocument");

// ── Invoices ──────────────────────────────────────────────────────

export const getInvoicesQuery = query(async (projectId: string) => {
	"use server";
	await requireAdmin();
	return db
		.select()
		.from(invoices)
		.where(eq(invoices.projectId, projectId))
		.orderBy(desc(invoices.createdAt));
}, "admin-invoices");

export const createInvoiceAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	await db.insert(invoices).values({
		projectId: String(formData.get("project_id")),
		number: String(formData.get("number")),
		amount: Number(formData.get("amount")),
		status: String(formData.get("status") || "draft") as InvoiceStatus,
		issueDate: new Date(String(formData.get("issue_date"))),
		dueDate: formData.get("due_date")
			? new Date(String(formData.get("due_date")))
			: null,
		paymentUrl: formData.get("payment_url")
			? String(formData.get("payment_url"))
			: null,
		notes: String(formData.get("notes") || ""),
	});
	const ref = formData.get("_referer");
	throw redirect(ref ? String(ref) : "/admin/companies");
}, "createInvoice");

export const deleteInvoiceAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const id = String(formData.get("id"));
	const storagePath = String(formData.get("storage_path") || "");
	try {
		if (storagePath) {
			const svc = supabaseService();
			await svc.storage.from("portal-docs").remove([storagePath]);
		}
		await db.delete(invoices).where(eq(invoices.id, id));
		return { success: "Invoice deleted." };
	} catch (e) {
		return { error: e instanceof Error ? e.message : "Failed to delete invoice." };
	}
}, "deleteInvoice");

// ── Deliverables ──────────────────────────────────────────────────

export const getDeliverablesQuery = query(async (projectId: string) => {
	"use server";
	await requireAdmin();
	const delvs = await db
		.select()
		.from(deliverables)
		.where(eq(deliverables.projectId, projectId))
		.orderBy(deliverables.sortOrder);

	if (delvs.length === 0) return [];

	const allUpdates = await db
		.select()
		.from(deliverableUpdates)
		.where(
			inArray(
				deliverableUpdates.deliverableId,
				delvs.map((d) => d.id),
			),
		);

	const updatesByDeliverable = new Map<
		string,
		typeof deliverableUpdates.$inferSelect[]
	>();
	for (const u of allUpdates) {
		const arr = updatesByDeliverable.get(u.deliverableId) ?? [];
		arr.push(u);
		updatesByDeliverable.set(u.deliverableId, arr);
	}

	return delvs.map((d) => ({
		...d,
		updates: updatesByDeliverable.get(d.id) ?? [],
	}));
}, "admin-deliverables");

export const createDeliverableAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const projectId = String(formData.get("project_id"));
	const [last] = await db
		.select({ sortOrder: deliverables.sortOrder })
		.from(deliverables)
		.where(eq(deliverables.projectId, projectId))
		.orderBy(desc(deliverables.sortOrder))
		.limit(1);
	const nextOrder = (last?.sortOrder ?? -1) + 1;
	await db.insert(deliverables).values({
		projectId,
		title: String(formData.get("title")),
		description: String(formData.get("description") || ""),
		sortOrder: nextOrder,
	});
	const ref = formData.get("_referer");
	throw redirect(ref ? String(ref) : "/admin/projects");
}, "createDeliverable");

export const updateDeliverableStatusAction = action(
	async (formData: FormData) => {
		"use server";
		await requireAdmin();
		const id = String(formData.get("id"));
		const status = String(formData.get("status")) as DeliverableStatus;
		await db
			.update(deliverables)
			.set({ status, updatedAt: new Date() })
			.where(eq(deliverables.id, id));
		const ref = formData.get("_referer");
		throw redirect(ref ? String(ref) : "/admin/projects");
	},
	"updateDeliverableStatus",
);

export const addDeliverableUpdateAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const deliverableId = String(formData.get("deliverable_id"));
	const body = String(formData.get("body"));
	if (!body.trim()) return { error: "Update cannot be empty" };
	await db.insert(deliverableUpdates).values({ deliverableId, body });
	await db
		.update(deliverables)
		.set({ updatedAt: new Date() })
		.where(eq(deliverables.id, deliverableId));
	const ref = formData.get("_referer");
	throw redirect(ref ? String(ref) : "/admin/projects");
}, "addDeliverableUpdate");

export const deleteDeliverableAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const id = String(formData.get("id"));
	try {
		await db.delete(deliverables).where(eq(deliverables.id, id));
		return { success: "Deliverable deleted." };
	} catch (e) {
		return { error: e instanceof Error ? e.message : "Failed to delete deliverable." };
	}
}, "deleteDeliverable");

// ── Meeting drafts (Anarlog publisher) ─────────────────────────────────

export interface TranscriptBlock {
	speaker: string;
	start_ms: number;
	end_ms: number;
	text: string;
}

function parseBlocks(raw: string): TranscriptBlock[] {
	const arr: unknown = JSON.parse(raw);
	if (!Array.isArray(arr)) throw new Error("blocks must be a JSON array");
	return arr.map((b: any) => ({
		speaker: String(b.speaker ?? "Speaker"),
		start_ms: Number(b.start_ms) || 0,
		end_ms: Number(b.end_ms) || 0,
		text: String(b.text ?? "").trim(),
	}));
}

export function renderTranscript(blocks: TranscriptBlock[]): string {
	return blocks
		.filter((b) => b.text)
		.map((b) => `${b.speaker}: ${b.text}`)
		.join("\n\n");
}

export const getMeetingDraftsQuery = query(async () => {
	"use server";
	await requireAdmin();
	return db
		.select({
			id: documents.id,
			title: documents.title,
			description: documents.description,
			createdAt: documents.createdAt,
			hasAudio: documents.audioPath,
			projectId: documents.projectId,
		})
		.from(documents)
		.where(eq(documents.visibility, "draft"))
		.orderBy(desc(documents.createdAt));
}, "admin-meeting-drafts");

export const getMeetingDraftQuery = query(async (id: string) => {
	"use server";
	await requireAdmin();
	const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
	return doc ?? null;
}, "admin-meeting-draft");

/** Persist in-editor changes (title, block text) without publishing. */
export const saveMeetingDraftAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const id = String(formData.get("id"));
	const title = String(formData.get("title") || "Untitled Transcript");
	const blocks = parseBlocks(String(formData.get("blocks_json")));
	await db
		.update(documents)
		.set({ title, transcriptJson: JSON.stringify(blocks) })
		.where(eq(documents.id, id));
	return { success: "Draft saved." };
}, "saveMeetingDraft");

/** Pad kept ranges ±300ms and merge overlaps/tiny gaps so cuts don't clip words. */
function mergeKeptRanges(blocks: TranscriptBlock[]): Array<[number, number]> {
	const PAD = 300;
	const sorted = blocks
		.filter((b) => b.end_ms > b.start_ms)
		.sort((a, b) => a.start_ms - b.start_ms)
		.map((b) => [Math.max(0, b.start_ms - PAD), b.end_ms + PAD] as [number, number]);
	const merged: Array<[number, number]> = [];
	for (const r of sorted) {
		const last = merged[merged.length - 1];
		if (last && r[0] <= last[1] + 500) {
			last[1] = Math.max(last[1], r[1]);
		} else {
			merged.push([...r] as [number, number]);
		}
	}
	return merged;
}

/** Publish a meeting draft: cut audio to the kept ranges, rewrite content,
 *  assign the project, flip visibility to client. */
export const publishMeetingAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const id = String(formData.get("id"));
	const projectId = String(formData.get("project_id") || "");
	if (!projectId) return { error: "Pick a project before publishing." };
	const blocks = parseBlocks(String(formData.get("blocks_json")));
	if (blocks.length === 0) return { error: "Nothing left to publish — all blocks cut." };

	const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
	if (!doc) return { error: "Draft not found." };

	const svc = supabaseService();
	let audioPath = doc.audioPath;
	let audioFileName = doc.audioFileName;

	// Audio must (a) reflect the cuts and (b) live under `${projectId}/` —
	// /api/download authorizes client access by path prefix.
	const needsRelocate = !!doc.audioPath && !doc.audioPath.startsWith(`${projectId}/`);
	const needsSplice = !!doc.audioPath;
	if (doc.audioPath && (needsRelocate || needsSplice)) {
		const { data: blob, error: dlErr } = await svc.storage
			.from("portal-docs")
			.download(doc.audioPath);
		if (dlErr || !blob) {
			return { error: `Could not fetch audio: ${dlErr?.message ?? "empty"}` };
		}

		let bytes: Buffer = Buffer.from(await blob.arrayBuffer());
		if (needsSplice) {
			const ranges = mergeKeptRanges(blocks);
			const spliced = await spliceAudio(bytes, ranges);
			if (spliced.error) return spliced;
			bytes = spliced.bytes!;
		}

		const newPath = `${projectId}/${Date.now()}-${(audioFileName || "audio.mp3").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
		const { error: upErr } = await svc.storage.from("portal-docs").upload(newPath, bytes, {
			contentType: "audio/mpeg",
		});
		if (upErr) return { error: `Audio re-upload failed: ${upErr.message}` };
		// Remove the original draft upload (old project-scoped paths stay if same project)
		if (doc.audioPath !== newPath) {
			await svc.storage.from("portal-docs").remove([doc.audioPath]);
		}
		audioPath = newPath;
	}

	await db
		.update(documents)
		.set({
			projectId,
			content: renderTranscript(blocks),
			transcriptJson: JSON.stringify(blocks),
			audioPath,
			audioFileName,
			visibility: "client",
		})
		.where(eq(documents.id, id));
	return { success: "Published." };
}, "publishMeeting");

/** ffmpeg keep-list splice: atrim each range, concat. Returns re-encoded mp3. */
async function spliceAudio(
	input: Buffer,
	ranges: Array<[number, number]>,
): Promise<{ bytes?: Buffer; error?: string }> {
	const { promises: fsp } = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");
	const { execFile } = await import("node:child_process");
	const run = (cmd: string, args: string[]) =>
		new Promise<{ ok: boolean; stderr: string }>((resolve) => {
			execFile(cmd, args, { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 }, (err, _so, se) =>
				resolve({ ok: !err, stderr: se || String(err) }),
			);
		});

	const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "mc-splice-"));
	const inPath = path.join(dir, "in.mp3");
	const outPath = path.join(dir, "out.mp3");
	await fsp.writeFile(inPath, input);

	const parts = ranges.map(
		([s, e], i) =>
			`[0:a]atrim=start=${(s / 1000).toFixed(3)}:end=${(e / 1000).toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`,
	);
	const filter =
		parts.join(";") + `;${ranges.map((_, i) => `[a${i}]`).join("")}concat=n=${ranges.length}:v=0:a=1[out]`;
	const res = await run("ffmpeg", [
		"-hide_banner", "-loglevel", "error",
		"-i", inPath,
		"-filter_complex", filter,
		"-map", "[out]",
		"-b:a", "96k",
		outPath,
	]);
	if (!res.ok) {
		return { error: `ffmpeg failed (is it installed?): ${res.stderr.slice(0, 300)}` };
	}
	const bytes = await fsp.readFile(outPath);
	await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
	return { bytes };
}
