// Self-check for doc exports + markdown round-trip (tables, page breaks).
// Run: bun test src/lib/doc-export.test.ts
import { test, expect } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
// DOC_NODES/DOC_TRANSFORMERS from the editor component (solid import is inert in bun)
import { DOC_NODES, DOC_TRANSFORMERS } from "~/lib/doc-markdown";
import JSZip from "jszip";
import { computePageMap, parseBlocks, renderDocx, renderPdf } from "~/lib/doc-export";

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

// ── blank-line fidelity: GDocs paste → empty paragraphs → markers → reload ──
const BLANK_MD = "para one\n\n<!-- blank -->\n\n<!-- blank -->\n\npara two\n";

test("blank round-trip: markers reload as empty paragraphs, not dropped", () => {
	const ed = createHeadlessEditor({ nodes: DOC_NODES, onError: (e) => { throw e; } });
	ed.update(() => $convertFromMarkdownString(BLANK_MD, DOC_TRANSFORMERS), { discrete: true });
	let paras = 0;
	let blanks = 0;
	let out = "";
	ed.read(() => {
		const root = JSON.parse(JSON.stringify(ed.getEditorState().toJSON())) as { root: { children: { type: string }[] } };
		paras = root.root.children.filter((c) => c.type === "paragraph").length;
		blanks = paras - 2; // two content paragraphs; the rest are blanks
		out = $convertToMarkdownString(DOC_TRANSFORMERS);
	});
	expect(blanks).toBe(2); // 2 markers → 2 empty paragraphs (GDocs look preserved)
	expect(out).toBe("para one\n\n<!-- blank -->\n\n<!-- blank -->\n\npara two"); // stable re-export (trailing \n dropped)
});

test("parseBlocks: blank marker detected for .docx/.pdf", () => {
	const blocks = parseBlocks(BLANK_MD);
	expect(blocks.filter((b) => b.t === "blank").length).toBe(2);
});

// ── escape fidelity + shared pagination brain ───────────────────────────

test("parseBlocks: backslash escapes stripped (\\_\\_ → __)", () => {
	const blocks = parseBlocks("Date: \\_\\_");
	const para = blocks.find((b) => b.t === "para");
	if (para?.t !== "para") throw new Error("unreachable");
	const text = para.spans.map((s) => s.text).join("");
	expect(text).toContain("__");
	expect(text).not.toContain("\\");
});

// 50 single-line paras ≈ 1150px of content — slightly taller than one 885px page
const LONG_MD = Array.from({ length: 50 }, (_, i) => `Paragraph ${i} with a few words of body text.`).join("\n\n");

test("computePageMap: reports 2 pages, same as renderPdf", async () => {
	const map = await computePageMap("T", LONG_MD);
	expect(map.length).toBe(51); // title + 50 blocks
	expect(new Set(map).size).toBe(2); // pages 0 and 1
	const buf = await renderPdf("T", LONG_MD);
	const pages = (new TextDecoder().decode(buf).match(/\/Type\s*\/Page[^s]/g) ?? []).length;
	expect(pages).toBe(2);
});

test("renderDocx: exactly one explicit page break for a 2-page doc", async () => {
	const buf = await renderDocx("T", LONG_MD);
	const zip = await JSZip.loadAsync(buf);
	const xml = (await zip.file("word/document.xml")?.async("text")) ?? "";
	expect((xml.match(/<w:br w:type="page"\/>/g) ?? []).length).toBe(1);
});

test("renderDocx: Heading2 style is Arial 16pt bold near-black", async () => {
	const buf = await renderDocx("T", MD);
	const zip = await JSZip.loadAsync(buf);
	const styles = (await zip.file("word/styles.xml")?.async("text")) ?? "";
	const h2 = styles.match(/<w:style [^>]*w:styleId="Heading2"[\s\S]*?<\/w:style>/)?.[0] ?? "";
	expect(h2).toContain("Arial");
	expect(h2).toContain("w:val=\"32\""); // 16pt in half-points
	expect(h2).toContain("w:color w:val=\"111111\"");
});

test("renderDocx: DIRECT run formatting + exact leading (Apple's importer ignores styles)", async () => {
	const buf = await renderDocx("T", "Plain **bold** para.\n\n## Head two");
	const zip = await JSZip.loadAsync(buf);
	const xml = (await zip.file("word/document.xml")?.async("text")) ?? "";
	expect((xml.match(/w:ascii="Arial"/g) ?? []).length).toBeGreaterThanOrEqual(4); // every run carries its font
	expect(xml).toContain('w:lineRule="exact"'); // editor-density leading on paragraphs
	expect(xml).toContain("<w:b/>"); // bold directly on the run
});
