import { query, action, redirect } from "@solidjs/router";
import { db } from "~/db";
import { docs } from "~/db/schema";
import { getAuthedClient } from "~/lib/session";
import { eq, desc } from "drizzle-orm";

async function requireAdmin() {
	const supabase = await getAuthedClient();
	if (!supabase) throw redirect("/admin/login");
}

export const getDocsQuery = query(async () => {
	"use server";
	await requireAdmin();
	return db.select().from(docs).orderBy(desc(docs.updatedAt)).limit(100);
}, "admin-docs");

export const getDocQuery = query(async (id: string) => {
	"use server";
	await requireAdmin();
	const [row] = await db.select().from(docs).where(eq(docs.id, id));
	if (!row) throw redirect("/admin/docs");
	return row;
}, "admin-doc");

export const createDocAction = action(async (formData: FormData) => {
	"use server";
	await requireAdmin();
	const title = String(formData.get("title") || "").trim() || "Untitled";
	const [row] = await db.insert(docs).values({ title }).returning();
	throw redirect(`/admin/docs/${row.id}`);
}, "createDoc");
