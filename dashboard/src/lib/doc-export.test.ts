// Self-check for doc exports + markdown round-trip (tables, page breaks).
// Run: bun test src/lib/doc-export.test.ts
import { test, expect } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
// DOC_NODES/DOC_TRANSFORMERS from the editor component (solid import is inert in bun)
import { DOC_NODES, DOC_TRANSFORMERS } from "~/lib/doc-markdown";
import { parseBlocks, renderDocx, renderPdf } from "~/lib/doc-export";

const MD = `# Title

Para with **bold** and [link](https://x.dev).

| Col A | Col B |
| --- | --- |
| 1 | 2 |

<!-- pagebreak -->

- one
- two
`;

test("parseBlocks: tables + pagebreak detected", () => {
	const blocks = parseBlocks(MD);
	const table = blocks.find((b) => b.t === "table");
	expect(table).toBeDefined();
	if (table?.t !== "table") throw new Error("unreachable");
	expect(table.header.map((c) => c.map((s) => s.text).join(""))).toEqual(["Col A", "Col B"]);
	expect(blocks.some((b) => b.t === "pagebreak")).toBe(true);
});

test("lexical round-trip: table + pagebreak survive", () => {
	const ed = createHeadlessEditor({ nodes: DOC_NODES, onError: (e) => { throw e; } });
	ed.update(() => $convertFromMarkdownString(MD, DOC_TRANSFORMERS), { discrete: true });
	let out = "";
	ed.read(() => (out = $convertToMarkdownString(DOC_TRANSFORMERS)));
	expect(out).toContain("| Col A | Col B |");
	expect(out).toContain("| --- | --- |");
	expect(out).toContain("| 1 | 2 |");
	expect(out).toContain("<!-- pagebreak -->");
});

test("renderDocx: valid .docx (zip magic)", async () => {
	const buf = await renderDocx("T", MD);
	expect(buf.byteLength).toBeGreaterThan(1000);
	expect(buf[0]).toBe(0x50); // P
	expect(buf[1]).toBe(0x4b); // K
});

test("renderPdf: valid .pdf, and page break makes 2+ pages", async () => {
	const buf = await renderPdf("T", MD);
	const head = new TextDecoder().decode(buf.slice(0, 5));
	expect(head).toBe("%PDF-");
	// pagebreak after short content → exactly 2 pages: 1 Page + contents per page
	const s = new TextDecoder().decode(buf);
	const pages = (s.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
	expect(pages).toBe(2);
});
