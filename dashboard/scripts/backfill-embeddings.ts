/**
 * Backfill embeddings for existing documents.
 * Run: cd dashboard && bun run scripts/backfill-embeddings.ts
 */
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
	process.env.VITE_SUPABASE_URL!,
	process.env.VITE_SUPABASE_SERVICE_KEY!,
	{ auth: { persistSession: false, autoRefreshToken: false } },
);

async function embed(text: string): Promise<number[]> {
	const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${process.env.VITE_OPENROUTER_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: "openai/text-embedding-3-small",
			input: text.slice(0, 8000),
		}),
	});
	if (!res.ok) throw new Error(`OpenAI error: ${await res.text()}`);
	const data = await res.json();
	return data.data[0].embedding;
}

async function main() {
	if (!process.env.VITE_OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_API_KEY === "your-openrouter-key-here") {
		console.error("Set VITE_OPENROUTER_API_KEY in .env first");
		process.exit(1);
	}

	const { data: docs, error } = await supabase
		.from("documents")
		.select("id, title, description, content")
		.is("embedding", null);

	if (error) {
		console.error("Fetch error:", error.message);
		process.exit(1);
	}

	if (!docs || docs.length === 0) {
		console.log("All documents already have embeddings.");
		return;
	}

	console.log(`Backfilling ${docs.length} documents…`);

	for (const doc of docs) {
		const text = [doc.title, doc.description, doc.content]
			.filter(Boolean)
			.join("\n\n");
		if (!text.trim()) {
			console.log(`  Skipping ${doc.title} — no text to embed`);
			continue;
		}
		try {
			const embedding = await embed(text);
			const { error } = await supabase
				.from("documents")
				.update({ embedding })
				.eq("id", doc.id);
			if (error) {
				console.error(`  Failed ${doc.title}: ${error.message}`);
			} else {
				console.log(`  ✓ ${doc.title}`);
			}
		} catch (e) {
			console.error(`  Failed ${doc.title}: ${e}`);
		}
	}

	console.log("Done.");
}

main();
