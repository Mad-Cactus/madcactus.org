import type { APIEvent } from "@solidjs/start/server";
import { getAuthedClient } from "~/lib/session";
import { lintVoiceText } from "~/lib/voice-lint-db";

/**
 * Voice lint API — admin-session guarded. Powers the inline lint panels in
 * DocEditor (docs/posts/newsletters) and the email draft editor.
 * POST { text, surface?, genre? } → { violations, avoidCount, checked }
 */
function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const SURFACES = ["email", "docs", "post", "newsletter"] as const;

export const POST = async (event: APIEvent) => {
	if ((await getAuthedClient()) === null) return json({ error: "Unauthorized" }, 401);
	const body = (await event.request.json().catch(() => ({}))) as { text?: string; surface?: string; genre?: string };
	const surface = SURFACES.includes((body.surface ?? "") as (typeof SURFACES)[number]) ? body.surface : undefined;
	const genre = body.genre?.trim().toLowerCase() || undefined;
	return json(await lintVoiceText(String(body.text ?? ""), surface ? { surface, genre } : undefined));
};
