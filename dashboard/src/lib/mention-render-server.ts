"use server";

// Client-safe facade over mention rendering. The implementation resolves
// cards through the component registry (→ ~/db), which must NEVER enter the
// client graph — routes import THIS module so the bundler ships an RPC stub
// instead of the chain (same arrangement as ~/lib/watch-video).
import { renderMentionsInMarkdown as impl, mentionTitles as implTitles } from "~/lib/mention-render";

export async function renderMentionsInMarkdown(markdown: string): Promise<string> {
	return impl(markdown);
}

export async function mentionTitles(markdown: string): Promise<string> {
	return implTitles(markdown);
}
