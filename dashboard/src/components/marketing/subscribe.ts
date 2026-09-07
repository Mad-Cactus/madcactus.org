// Newsletter signup — same-origin POST to the dashboard API (the marketing
// pages and the API are one app now; no cross-origin localhost juggling).
export async function subscribeToNewsletter(email: string, scoreData?: unknown): Promise<{ ok: boolean; error?: string }> {
	try {
		const res = await fetch("/api/newsletter", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, ...(scoreData ? { scoreData } : {}) }),
		});
		const data = (await res.json()) as { ok?: boolean; error?: string };
		if (data.ok) return { ok: true };
		return { ok: false, error: data.error || "Failed" };
	} catch {
		return { ok: false, error: "Failed" };
	}
}
