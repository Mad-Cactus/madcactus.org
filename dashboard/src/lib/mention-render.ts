// Mention rendering for surfaces that render markdown as HTML/PDF without
// the Lexical editor: turns @[kind:id] into hover-card anchors (web) or
// plain @Title (exports). A reference, not a copy — labels resolve live from
// the registry at render time. Unknown kinds and deleted targets degrade to
// the raw text, never an error. Server-only (registry → db).
import { parseMentions } from "~/lib/entity-links";
import { resolveCards } from "~/registry/registry";
import type { ComponentCard } from "~/registry/types";

const esc = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function replaceMentions(
	markdown: string,
	render: (raw: string, ref: { kind: string; id: string }, card: ComponentCard | null) => string,
): Promise<string> {
	// parseMentions already dedupes + skips unknown kinds; resolve each once
	const refs = parseMentions(markdown);
	if (!refs.length) return Promise.resolve(markdown);
	return resolveCards(refs).then((cards) => {
		const byKey = new Map(refs.map((ref, i) => [`${ref.kind}:${ref.id}`, cards[i]]));
		// replace EVERY occurrence (mentions repeat; refs are deduped)
		return markdown.replace(/@\[([a-z0-9-]+):([a-z0-9-]+)\]/gi, (raw, kind: string, id: string) => {
			const card = byKey.get(`${kind}:${id}`) ?? null;
			return render(raw, { kind, id }, card);
		});
	});
}

/** Web render: @[kind:id] → inline raw-HTML chip anchor (marked passes inline
 *  HTML through). Admin hover popovers hook the data attrs; public pages get
 *  the live label + optional public link. Deleted/unknown → raw text. */
export function renderMentionsInMarkdown(markdown: string): Promise<string> {
	return replaceMentions(markdown, (raw, ref, card) => {
		if (!card || card.deleted) return raw;
		const label = `@${esc(card.title)}`;
		const status = card.statusLabel ? `<span class="component-mention-status">${esc(card.statusLabel)}</span>` : "";
		const link = card.publicUrl
			? `<a href="${esc(card.publicUrl)}" class="component-mention-link">${label}</a>`
			: `<span class="component-mention-link">${label}</span>`;
		return `<span class="component-mention" data-kind="${esc(ref.kind)}" data-id="${esc(ref.id)}">${link}${status}</span>`;
	});
}

/** Export degrade: @[kind:id] → @Title (PDF/DOCX keep plain text). Unknown
 *  kinds and deleted targets keep the raw @[kind:id] text. */
export function mentionTitles(markdown: string): Promise<string> {
	return replaceMentions(markdown, (raw, _ref, card) => (card && !card.deleted ? `@${card.title}` : raw));
}
