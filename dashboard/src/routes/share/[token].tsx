import { Title } from "@solidjs/meta";
import { useParams } from "@solidjs/router";
import { createResource, For, Match, Switch } from "solid-js";
import { getDocByShareToken } from "~/lib/docs";

// ponytail: 20-line markdown→HTML for headings/bold/italic/code/lists/links —
// enough for share previews. If shared docs need full GFM, swap in marked.
function mdToHtml(md: string): string {
	const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const inline = (s: string) =>
		esc(s)
			.replace(/`([^`]+)`/g, "<code>$1</code>")
			.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
			.replace(/\*([^*]+)\*/g, "<em>$1</em>")
			.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
	const out: string[] = [];
	let inList = false;
	for (const line of md.split("\n")) {
		const li = line.match(/^\s*[-*]\s+(.*)/);
		if (li) {
			if (!inList) (out.push("<ul>"), (inList = true));
			out.push(`<li>${inline(li[1])}</li>`);
			continue;
		}
		if (inList) (out.push("</ul>"), (inList = false));
		const h = line.match(/^(#{1,4})\s+(.*)/);
		if (h) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
		else if (line.trim() === "") out.push("");
		else if (line.startsWith("```")) out.push("<pre>");
		else out.push(`<p>${inline(line)}</p>`);
	}
	if (inList) out.push("</ul>");
	return out.join("\n");
}

export default function SharedDoc() {
	const params = useParams();
	const [doc] = createResource(async () => getDocByShareToken(params.token ?? ""));

	return (
		<main style={{ "max-width": "720px", margin: "48px auto", padding: "0 24px", "font-family": "Georgia, 'Times New Roman', serif" }}>
			<Switch fallback={<Title>Not found</Title>}>
				<Match when={!doc.loading && !doc()}>
					<Title>Not found — Mad Cactus</Title>
					<p class="muted">This share link is invalid or was unshared.</p>
				</Match>
				<Match when={doc()}>
					<Title>{doc()!.title} — Mad Cactus</Title>
					<h1>{doc()!.title}</h1>
					<For each={[mdToHtml(doc()!.markdown)]}>{(html) => <div innerHTML={html} />}</For>
				</Match>
			</Switch>
		</main>
	);
}
