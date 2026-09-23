// Markdown → .docx / .pdf export for internal docs.
// One lexer (marked, same engine the web/email previews use) feeding two
// backends over ONE shared pagination walk: walkBlocks() measures every block
// with pdfkit metrics (the same page-spec constants the editor pager uses) and
// decides page fits. The PDF backend draws during the walk; the DOCX backend
// consumes the resulting page map and injects explicit page breaks so
// Word/Pages match the editor's pagination. Supported blocks: headings,
// paragraphs, lists, code, blockquote, GFM tables, hr, and the page-break
// marker `<!-- pagebreak -->` → a real page break in both formats.
// Server-only — imports docx + pdfkit; never import from a client component.
import { marked, type Token } from "marked";
import type PDFKit from "pdfkit";
import {
	BorderStyle,
	Document,
	ExternalHyperlink,
	HeadingLevel,
	PageBreak,
	Packer,
	ShadingType,
	TextRun,
	WidthType,
	Table,
	TableCell,
	TableRow,
	Paragraph,
	type IParagraphOptions,
} from "docx";
import { SPEC, pt, CONTENT_W, CONTENT_H } from "~/lib/page-spec";

export const PAGEBREAK_MD = "<!-- pagebreak -->";

// ── inline ────────────────────────────────────────────────────────────────
// ponytail: flat regex tokenizer — **bold**, *italic*, `code`, [text](url).
// No nesting (bold-italic, links inside bold). Upgrade path: walk the inline
// token tree marked already produces for paragraph blocks.
type Span = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string };

const INLINE_RE = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

// CommonMark's escapable ASCII punctuation — `\*` → `*`, `\_` → `_`, …
const ESCAPABLE = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g;

function spans(md: string): Span[] {
	const out: Span[] = [];
	let last = 0;
	for (let m: RegExpExecArray | null; (m = INLINE_RE.exec(md)); ) {
		if (m.index > last) out.push({ text: md.slice(last, m.index) });
		if (m[1] !== undefined) out.push({ text: m[1], bold: true });
		else if (m[2] !== undefined) out.push({ text: m[2], italic: true });
		else if (m[3] !== undefined) out.push({ text: m[3], code: true });
		else if (m[4] !== undefined) out.push({ text: m[4], href: m[5] });
		last = m.index + m[0].length;
	}
	if (last < md.length) out.push({ text: md.slice(last) });
	// strip backslash escapes from emitted text (code spans keep them — the
	// backslash is literal inside backticks, same as the editor renders)
	return (out.length ? out : [{ text: "" }]).map((s) => (s.code ? s : { ...s, text: s.text.replace(ESCAPABLE, "$1") }));
}

const plain = (ss: Span[]) => ss.map((s) => s.text).join("");

// ── block parse ───────────────────────────────────────────────────────────
type Block =
	| { t: "heading"; depth: number; spans: Span[] }
	| { t: "para"; spans: Span[] }
	| { t: "quote"; blocks: Block[] }
	| { t: "list"; ordered: boolean; items: Block[][] }
	| { t: "code"; text: string; lang?: string }
	| { t: "table"; header: Span[][]; rows: Span[][][] }
	| { t: "hr" }
	| { t: "pagebreak" }
	| { t: "blank" }; // `<!-- blank -->` — one empty line (GDocs blank-line parity)

function parseTokens(tokens: Token[]): Block[] {
	const out: Block[] = [];
	for (const tok of tokens) {
		switch (tok.type) {
			case "heading":
				out.push({ t: "heading", depth: tok.depth, spans: spans(tok.text) });
				break;
			case "paragraph":
				out.push({ t: "para", spans: spans(tok.text) });
				break;
			case "blockquote":
				out.push({ t: "quote", blocks: parseTokens((tok as { tokens?: Token[] }).tokens ?? []) });
				break;
			case "list": {
				const list = tok as Extract<Token, { type: "list" }>;
				out.push({ t: "list", ordered: !!list.ordered, items: list.items.map((i) => parseTokens(i.tokens ?? [])) });
				break;
			}
			case "code":
				out.push({ t: "code", text: tok.text, lang: tok.lang });
				break;
			case "table": {
				const tb = tok as Extract<Token, { type: "table" }>;
				out.push({
					t: "table",
					header: tb.header.map((c) => spans(c.text)),
					rows: tb.rows.map((r) => r.map((c) => spans(c.text))),
				});
				break;
			}
			case "hr":
				out.push({ t: "hr" });
				break;
			case "html":
				if (/pagebreak/i.test(tok.text)) out.push({ t: "pagebreak" });
				else if (/<!--\s*blank\s*-->/.test(tok.text)) out.push({ t: "blank" });
				break;
			case "text":
				out.push({ t: "para", spans: spans(tok.text) });
				break;
			// space, def, etc. → skip
		}
	}
	return out;
}

export function parseBlocks(md: string): Block[] {
	return parseTokens(marked.lexer(md));
}

// ── shared layout walk ────────────────────────────────────────────────────
// One pagination brain. walkBlocks measures with pdfkit (Arial ≡ Helvetica,
// Courier New ≡ Courier) and runs the fit rules: blocks never split,
// quotes/tables/code never split, `<!-- pagebreak -->` honored, the title is
// block 0 on page 1. st.y is SPEC px from the content-area top; pt() converts
// only at the backend boundary.
type St = { page: number; y: number };

interface Emit {
	newPage(): void;
	heading(spans: Span[], size: number): void;
	para(spans: Span[]): void;
	quotePara(spans: Span[]): void;
	listItem(marker: string, spans: Span[]): void;
	code(text: string, h: number): void;
	tableRow(cells: Span[][], head: boolean, h: number, colW: number): void;
	hr(): void;
}

const noopEmit: Emit = { newPage() {}, heading() {}, para() {}, quotePara() {}, listItem() {}, code() {}, tableRow() {}, hr() {} };

function walkBlocks(blocks: Block[], st: St, doc: PDFKit.PDFDocument, emit: Emit, map: number[] | null) {
	const measure = (ss: Span[], size: number, width = CONTENT_W) =>
		doc.font("Helvetica").fontSize(pt(size)).heightOfString(plain(ss), { width: pt(width) }) / 0.75;
	const fit = (h: number) => {
		if (st.y + h > CONTENT_H) {
			emit.newPage();
			st.page++;
			st.y = 0;
		}
	};

	for (const b of blocks) {
		if (map) map.push(st.page);
		switch (b.t) {
			case "heading": {
				const d = Math.min(6, Math.max(1, b.depth));
				const size = SPEC.hSizes[d - 1];
				const h = measure(b.spans, size);
				fit(SPEC.hBefore[d - 1] + h + SPEC.hAfter);
				st.y += SPEC.hBefore[d - 1];
				emit.heading(b.spans, size);
				st.y += h + SPEC.hAfter;
				break;
			}
			case "para": {
				const h = measure(b.spans, SPEC.body);
				fit(h + SPEC.paraAfter);
				emit.para(b.spans);
				st.y += h + SPEC.paraAfter;
				break;
			}
			case "quote": {
				let used = SPEC.quoteBefore + SPEC.quoteAfter;
				for (const inner of b.blocks) if (inner.t === "para") used += measure(inner.spans, SPEC.body, CONTENT_W - SPEC.quoteIndent);
				fit(used); // quotes never split across pages
				st.y += SPEC.quoteBefore;
				for (const inner of b.blocks) {
					if (inner.t !== "para") {
						walkBlocks([inner], st, doc, emit, null);
						continue;
					}
					emit.quotePara(inner.spans);
					st.y += measure(inner.spans, SPEC.body, CONTENT_W - SPEC.quoteIndent);
				}
				st.y += SPEC.quoteAfter;
				break;
			}
			case "list": {
				let i = 0;
				for (const item of b.items) {
					for (const inner of item) {
						if (inner.t !== "para") {
							walkBlocks([inner], st, doc, emit, null);
							continue;
						}
						const marker = b.ordered ? `${i + 1}.` : "\u2022";
						const h = measure([{ text: `${marker}  ` }, ...inner.spans], SPEC.body, CONTENT_W - SPEC.listIndent);
						fit(h + SPEC.listItemAfter);
						emit.listItem(marker, inner.spans);
						st.y += h + SPEC.listItemAfter;
					}
					i++;
				}
				st.y += SPEC.listAfter;
				break;
			}
			case "code": {
				const innerW = CONTENT_W - 2 * SPEC.codePadX;
				const h = doc.font("Courier").fontSize(pt(SPEC.codeFont)).heightOfString(b.text, { width: pt(innerW) }) / 0.75 + 2 * SPEC.codePadY;
				fit(h + SPEC.codeAfter); // code blocks never split across pages
				emit.code(b.text, h);
				st.y += h + SPEC.codeAfter;
				break;
			}
			case "table": {
				const cols = Math.max(1, b.header.length);
				const colW = CONTENT_W / cols;
				const cellTextW = colW - 2 * SPEC.tablePadX;
				const rowH = (cells: Span[][], head: boolean) =>
					Math.max(...cells.map((c) => doc.font(head ? "Helvetica-Bold" : "Helvetica").fontSize(pt(SPEC.tableFont)).heightOfString(plain(c), { width: pt(cellTextW) }) / 0.75)) + 2 * SPEC.tablePadY;
				const rows = [{ cells: b.header, head: true, h: rowH(b.header, true) }, ...b.rows.map((r) => ({ cells: r, head: false, h: rowH(r, false) }))];
				fit(rows.reduce((n, r) => n + r.h, 0) + SPEC.tableAfter); // tables never split across pages
				for (const r of rows) {
					emit.tableRow(r.cells, r.head, r.h, colW);
					st.y += r.h;
				}
				st.y += SPEC.tableAfter;
				break;
			}
			case "hr":
				fit(SPEC.hrBefore + SPEC.hrAfter);
				emit.hr();
				st.y += SPEC.hrBefore + SPEC.hrAfter;
				break;
			case "pagebreak":
				emit.newPage();
				st.page++;
				st.y = 0;
				break;
			case "blank":
				// one empty body line (SPEC.lh) — matches the blank paragraph in the editor
				fit(SPEC.body * SPEC.lh);
				st.y += SPEC.body * SPEC.lh;
				break;
		}
	}
}

const titleHeight = (doc: PDFKit.PDFDocument, title: string) =>
	doc.font("Helvetica-Bold").fontSize(pt(SPEC.title)).heightOfString(title, { width: pt(CONTENT_W) }) / 0.75;

// metrics-only pdfkit doc — never piped, no I/O
async function metricsDoc(): Promise<PDFKit.PDFDocument> {
	const PDFDocument = (await import("pdfkit")).default;
	return new PDFDocument({ autoFirstPage: false });
}

// Page index per entry: [title, ...top-level blocks]. Title is entry 0.
export async function computePageMap(title: string, md: string): Promise<number[]> {
	const doc = await metricsDoc();
	const map = [0];
	walkBlocks(parseBlocks(md), { page: 0, y: titleHeight(doc, title) }, doc, noopEmit, map);
	doc.end();
	return map;
}

// ── .docx ─────────────────────────────────────────────────────────────────
const CODE_FONT = "Courier New";
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
// editor-look ink + gold underline (page-spec typography, twips = pt × 20)
const INK = "111111";
const GOLD = "BC9C5C";

function docxRuns(ss: Span[], bold = false) {
	return ss.map((s) => {
		// editor look: dark text with a gold underline — not Word's blue Hyperlink style
		if (s.href) return new ExternalHyperlink({ link: s.href, children: [new TextRun({ text: s.text, color: INK, underline: { color: GOLD } })] });
		return new TextRun({ text: s.text, bold: s.bold || bold, italics: s.italic, font: s.code ? CODE_FONT : undefined });
	});
}

function docxBlocks(blocks: Block[]): (Paragraph | Table)[] {
	const out: (Paragraph | Table)[] = [];
	const para = (ss: Span[], extra: IParagraphOptions = {}) => new Paragraph({ children: docxRuns(ss), ...extra });

	for (const b of blocks) {
		switch (b.t) {
			case "heading":
				out.push(new Paragraph({ children: docxRuns(b.spans), heading: HEADINGS[b.depth - 1] ?? HEADINGS[5] }));
				break;
			case "para":
				out.push(para(b.spans, { spacing: { after: 140 } })); // 7pt — SPEC.paraAfter
				break;
			case "quote":
				for (const inner of b.blocks) {
					if (inner.t === "para")
						out.push(
							new Paragraph({
								children: docxRuns(inner.spans),
								indent: { left: 360 },
								spacing: { after: 160 }, // 8pt — SPEC.quoteAfter
								border: { left: { style: BorderStyle.SINGLE, size: 18, color: GOLD, space: 4 } },
							}),
						);
					else out.push(...docxBlocks([inner]));
				}
				break;
			case "list":
				b.items.forEach((item, i) => {
					for (const inner of item) {
						if (inner.t !== "para") {
							out.push(...docxBlocks([inner]));
							continue;
						}
						if (b.ordered)
							// ponytail: faked "N." marker, no Word numbering config — upgrade if an export needs real numbered lists
							out.push(new Paragraph({ children: [new TextRun({ text: `${i + 1}.  ` }), ...docxRuns(inner.spans)], indent: { left: 360 }, spacing: { after: 80 } }));
						// Word-native hanging indent: wrapped lines align under the text
						else out.push(new Paragraph({ children: docxRuns(inner.spans), bullet: { level: 0 }, spacing: { after: 80 } }));
					}
				});
				break;
			case "code":
				out.push(
					new Paragraph({
						children: [new TextRun({ text: b.text, font: CODE_FONT, size: 20 })],
						shading: { type: ShadingType.CLEAR, fill: "F4F4F4" },
						spacing: { before: 80, after: 160 }, // SPEC.codeAfter = 8pt
					}),
				);
				break;
			case "table": {
				const cols = b.header.length || 1;
				const width = { size: Math.floor(100 / cols), type: WidthType.PERCENTAGE };
				const cell = (ss: Span[], head: boolean) =>
					new TableCell({
						width,
						margins: { top: 80, bottom: 80, left: 120, right: 120 },
						shading: head ? { type: ShadingType.CLEAR, fill: "EFEADD" } : undefined,
						children: [para(ss.map((s) => ({ ...s, bold: s.bold || head })))],
					});
				out.push(
					new Table({
						width: { size: 100, type: WidthType.PERCENTAGE },
						rows: [
							new TableRow({ tableHeader: true, children: b.header.map((c) => cell(c, true)) }),
							...b.rows.map((r) => new TableRow({ children: r.map((c) => cell(c, false)) })),
						],
					}),
				);
				out.push(para([{ text: "" }], { spacing: { after: 0 } })); // spacing after table
				break;
			}
			case "hr":
				out.push(
					new Paragraph({
						children: [new TextRun({ text: "" })],
						border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } },
						spacing: { before: 160, after: 280 }, // SPEC.hrBefore / hrAfter
					}),
				);
				break;
			case "pagebreak":
				out.push(new Paragraph({ children: [new PageBreak()] }));
				break;
			case "blank":
				// one empty line at body size — same height a blank line occupies in GDocs
				out.push(new Paragraph({ children: [new TextRun({ text: "" })], spacing: { after: 0 } }));
				break;
		}
	}
	return out;
}

export async function renderDocx(title: string, md: string): Promise<Uint8Array<ArrayBuffer>> {
	const blocks = parseBlocks(md);
	const map = await computePageMap(title, md);
	// explicit breaks where the shared walk increments the page — a `<!-- pagebreak -->`
	// block already emits its own break, so only top up the counter for it
	let page = 0;
	const children: (Paragraph | Table)[] = [
		new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 44, color: INK })], spacing: { after: 200 } }), // 22pt, 10pt after
	];
	blocks.forEach((b, i) => {
		if (b.t !== "pagebreak") {
			while (page < map[i + 1]) {
				children.push(new Paragraph({ children: [new PageBreak()] }));
				page++;
			}
		}
		page = Math.max(page, map[i + 1]);
		children.push(...docxBlocks([b]));
	});
	const doc = new Document({
		styles: {
			default: {
				document: { run: { font: "Arial", size: 22, color: INK } }, // 11pt body — SPEC sizes below
				heading1: { run: { font: "Arial", size: 42, bold: true, color: INK }, paragraph: { spacing: { before: 280, after: 60 } } },
				heading2: { run: { font: "Arial", size: 32, bold: true, color: INK }, paragraph: { spacing: { before: 280, after: 60 } } },
				heading3: { run: { font: "Arial", size: 27, bold: true, color: INK }, paragraph: { spacing: { before: 200, after: 60 } } },
				heading4: { run: { font: "Arial", size: 24, bold: true, color: INK }, paragraph: { spacing: { before: 200, after: 60 } } },
				heading5: { run: { font: "Arial", size: 22, bold: true, color: INK }, paragraph: { spacing: { before: 200, after: 60 } } },
				heading6: { run: { font: "Arial", size: 22, bold: true, color: INK }, paragraph: { spacing: { before: 200, after: 60 } } },
			},
		},
		sections: [
			{
				properties: { page: { margin: { top: 1280, bottom: 1280, left: 1280, right: 1280 } } }, // 64pt — SPEC.pad
				children,
			},
		],
	});
	const buf = await Packer.toBuffer(doc);
	const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
	out.set(buf);
	return out;
}

// ── .pdf ──────────────────────────────────────────────────────────────────
// Layout mirrors the editor pager via page-spec + the shared walkBlocks above:
// letter, 64pt margins, Helvetica ≡ Arial, block-level pagination.
const GOLD_PDF = "#bc9c5c";

export async function renderPdf(title: string, md: string): Promise<Uint8Array<ArrayBuffer>> {
	const PDFDocument = (await import("pdfkit")).default;
	return new Promise((resolve, reject) => {
		try {
			const doc = new PDFDocument({ size: "LETTER", margins: { top: pt(SPEC.pad), bottom: pt(SPEC.pad), left: pt(SPEC.pad), right: pt(SPEC.pad) } });
			const chunks: Uint8Array[] = [];
			doc.on("data", (c: Uint8Array) => chunks.push(c));
			doc.on("error", reject);
			doc.on("end", () => {
				const out = new Uint8Array(new ArrayBuffer(chunks.reduce((n, c) => n + c.length, 0)));
				let off = 0;
				for (const c of chunks) {
					out.set(c, off);
					off += c.length;
				}
				resolve(out);
			});

			const LEFT = pt(SPEC.pad);
			const CW = pt(CONTENT_W);
			const st: St = { page: 0, y: 0 };
			const absY = (px: number) => pt(SPEC.pad + px);

			const write = (ss: Span[], opts: { x?: number; width?: number; size: number; bold?: boolean; italic?: boolean; color?: string }) => {
				const x = LEFT + pt(opts.x ?? 0);
				const width = pt(opts.width ?? CONTENT_W);
				let first = true;
				for (const s of ss) {
					doc
						.font(s.code ? "Courier" : s.bold || opts.bold ? "Helvetica-Bold" : s.italic || opts.italic ? "Helvetica-Oblique" : "Helvetica")
						.fontSize(pt(opts.size))
						.fillColor(opts.color ?? "#111");
					// editor link look: dark text, gold underline (not blue)
					doc.text(s.text, x, first ? absY(st.y) : undefined, { width, continued: s !== ss[ss.length - 1], ...(s.href ? { link: s.href, underline: true, underlineColor: GOLD_PDF } : {}) });
					first = false;
				}
			};

			const emit: Emit = {
				newPage: () => doc.addPage(),
				heading: (ss, size) => write(ss, { size, bold: true }),
				para: (ss) => write(ss, { size: SPEC.body }),
				quotePara: (ss) => write(ss, { size: SPEC.body, italic: true, color: "#555", x: SPEC.quoteIndent, width: CONTENT_W - SPEC.quoteIndent }),
				listItem: (marker, ss) => write([{ text: `${marker}  ` }, ...ss], { size: SPEC.body, x: SPEC.listIndent, width: CONTENT_W - SPEC.listIndent }),
				code: (text, h) => {
					const innerW = CONTENT_W - 2 * SPEC.codePadX;
					doc.rect(LEFT + pt(-SPEC.codePadX), absY(st.y - SPEC.codePadY), pt(CONTENT_W + 2 * SPEC.codePadX), pt(h)).fill("#f4f4f4");
					doc.font("Courier").fontSize(pt(SPEC.codeFont)).fillColor("#333").text(text, LEFT + pt(SPEC.codePadX), absY(st.y + SPEC.codePadY), { width: pt(innerW) });
				},
				tableRow: (cells, head, rowH, colW) => {
					if (head) doc.rect(LEFT, absY(st.y), CW, pt(rowH)).fill("#efeadd");
					cells.forEach((c, ci) => {
						doc.rect(LEFT + pt(ci * colW), absY(st.y), pt(colW), pt(rowH)).lineWidth(0.5).strokeColor("#bbb").stroke();
						write(c, { size: SPEC.tableFont, bold: head, x: ci * colW + SPEC.tablePadX, width: colW - 2 * SPEC.tablePadX });
					});
				},
				hr: () => doc.moveTo(LEFT, absY(st.y + SPEC.hrBefore)).lineTo(LEFT + CW, absY(st.y + SPEC.hrBefore)).lineWidth(1).strokeColor("#ccc").stroke(),
			};

			// doc title on page 1, then flow
			doc.font("Helvetica-Bold").fontSize(pt(SPEC.title)).fillColor("#111");
			doc.text(title, LEFT, absY(0));
			st.y = titleHeight(doc, title) + SPEC.titleAfter;
			walkBlocks(parseBlocks(md), st, doc, emit, null);
			doc.end();
		} catch (e) {
			reject(e);
		}
	});
}
