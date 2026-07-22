const OPENROUTER_URL = "https://openrouter.ai/api/v1/embeddings";

/**
 * Generate embedding via OpenRouter (openai/text-embedding-3-small).
 * Returns 1536-dim float array. Throws on error.
 */
export async function embed(text: string): Promise<number[]> {
	const key = import.meta.env.VITE_OPENROUTER_API_KEY;
	if (!key) throw new Error("VITE_OPENROUTER_API_KEY not set");

	const truncated = text.slice(0, 8000);

	const res = await fetch(OPENROUTER_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: "openai/text-embedding-3-small",
			input: truncated,
		}),
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`OpenRouter embedding failed: ${err}`);
	}

	const data = await res.json();
	return data.data[0].embedding as number[];
}
