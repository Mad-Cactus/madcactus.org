import { query, redirect } from "@solidjs/router";
import { getClientClient } from "./client-session";
import { embed } from "./embeddings";
import { supabaseService } from "./supabase";
import type { Document } from "./supabase";

export interface SearchResult extends Document {
	similarity: number;
}

/** Semantic search over client-visible documents for the logged-in client. */
export const searchDocumentsQuery = query(async (q: string) => {
	"use server";
	const cc = await getClientClient();
	if (!cc) throw redirect("/portal/login");

	let queryEmbedding: number[];
	try {
		queryEmbedding = await embed(q);
	} catch {
		return [];
	}

	const svc = supabaseService();
	const { data, error } = await svc.rpc("match_documents", {
		query_embedding: queryEmbedding,
		filter_project_id: cc.client.project_id,
		match_count: 10,
	});

	if (error) return [];
	return (data ?? []) as SearchResult[];
}, "search-documents");

/** Admin semantic search across a project's documents. */
export const adminSearchDocumentsQuery = query(
	async (q: string, projectId: string) => {
		"use server";
		let queryEmbedding: number[];
		try {
			queryEmbedding = await embed(q);
		} catch {
			return [];
		}

		const svc = supabaseService();
		const { data, error } = await svc.rpc("match_documents", {
			query_embedding: queryEmbedding,
			filter_project_id: projectId,
			match_count: 10,
		});

		if (error) return [];
		return (data ?? []) as SearchResult[];
	},
	"admin-search-documents",
);
