// Markdown → .docx / .pdf export for internal docs.
// One lexer (marked, same engine the web/email previews use) feeding two
// backends: docx (npm) and pdfkit. Supported blocks: headings, paragraphs,
// lists, code, blockquote, GFM tables, hr, and the page-break marker
// `<!-- pagebreak -->` → a real page break in both formats.
// Server-only — imports docx + pdfkit; never import from a client component.
import { marked, type Token } from "marked";
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

export const PAGEBREAK_MD = "<!-- pagebreak -->";

// ── inline ────────────────────────────────────────────────────────────────
// ponytail: flat regex tokenizer — **bold**, *italic*, `code`, [text](url).
// No nesting (bold-italic, links inside bold). Upgrade path: walk the inline
// token tree marked already produces for paragraph blocks.
type Span = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string };

const INLINE_RE = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

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
	return out.length ? out : [{ text: "" }];
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
	| { t: "pagebreak" };

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

// ── .docx ─────────────────────────────────────────────────────────────────
const CODE_FONT = "Courier New";
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

function docxRuns(ss: Span[], bold = false) {
	return ss.map((s) => {
		if (s.href) return new ExternalHyperlink({ link: s.href, children: [new TextRun({ text: s.text, style: "Hyperlink" })] });
		return new TextRun({ text: s.text, bold: s.bold || bold, italics: s.italic, font: s.code ? CODE_FONT : undefined });
	});
}

function docxBlocks(blocks: Block[]): (Paragraph | Table)[] {
	const out: (Paragraph | Table)[] = [];
	const bulletPara = (ss: Span[], marker: string) => new Paragraph({ children: [new TextRun({ text: `${marker}  ` }), ...docxRuns(ss)], indent: { left: 360 } });
	const para = (ss: Span[], extra: IParagraphOptions = {}) => new Paragraph({ children: docxRuns(ss), ...extra });

	for (const b of blocks) {
		switch (b.t) {
			case "heading":
				out.push(new Paragraph({ children: docxRuns(b.spans), heading: HEADINGS[b.depth - 1] ?? HEADINGS[5] }));
				break;
			case "para":
				out.push(para(b.spans, { spacing: { after: 120 } }));
				break;
			case "quote":
				for (const inner of b.blocks) {
					if (inner.t === "para")
						out.push(
							new Paragraph({
								children: docxRuns(inner.spans),
								indent: { left: 360 },
								border: { left: { style: BorderStyle.SINGLE, size: 18, color: "BC9C5C", space: 4 } },
							}),
						);
					else out.push(...docxBlocks([inner]));
				}
				break;
			case "list":
				b.items.forEach((item, i) => {
					const marker = b.ordered ? `${i + 1}.` : "•";
					for (const inner of item) {
						if (inner.t === "para") out.push(bulletPara(inner.spans, marker));
						else out.push(...docxBlocks([inner]));
					}
				});
				break;
			case "code":
				out.push(
					new Paragraph({
						children: [new TextRun({ text: b.text, font: CODE_FONT, size: 20 })],
						shading: { type: ShadingType.CLEAR, fill: "F4F4F4" },
						spacing: { before: 80, after: 80 },
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
				out.push(para([{ text: "" }])); // spacing after table
				break;
			}
			case "hr":
				out.push(
					new Paragraph({
						children: [new TextRun({ text: "" })],
						border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } },
						spacing: { before: 120, after: 120 },
					}),
				);
				break;
			case "pagebreak":
				out.push(new Paragraph({ children: [new PageBreak()] }));
				break;
		}
	}
	return out;
}

export async function renderDocx(title: string, md: string): Promise<Uint8Array<ArrayBuffer>> {
	const doc = new Document({
		styles: { default: { document: { run: { font: "Helvetica", size: 22 } } } },
		sections: [
			{
				properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
				children: [
					new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 56 })], spacing: { after: 240 } }),
					...docxBlocks(parseBlocks(md)),
				],
			},
		],
	});
	const buf = await Packer.toBuffer(doc);
	const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
	out.set(buf);
	return out;
}

// ── .pdf ──────────────────────────────────────────────────────────────────
// Layout mirrors ~/lib/page-spec (the editor pager uses the same constants):
// letter, 64pt margins, Helvetica at scaled sizes, and BLOCK-LEVEL pagination
// — a block that doesn't fit in the remaining space starts the next page
// (paragraphs are never split mid-block). That rule is what makes the editor's
// page breaks match the export.
// y is tracked in SPEC px, relative to the top of the content area; the only
// pt conversion happens at draw time: pt(SPEC.pad + y).
import { SPEC, pt, CONTENT_W, CONTENT_H } from "~/lib/page-spec";

const GOLD = "#bc9c5c";

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
			let y = 0; // px from content-area top

			// block-level pagination: a block that doesn't fit starts a new page
			const fit = (h: number) => {
				if (y + h > CONTENT_H) {
					doc.addPage();
					y = 0;
				}
			};
			const absY = (px: number) => pt(SPEC.pad + px);

			// measure in px with the base font (mixed-font measure is approximate — ponytail)
			const measure = (ss: Span[], size: number, width = CONTENT_W) =>
				doc.font("Helvetica").fontSize(pt(size)).heightOfString(plain(ss), { width: pt(width) }) / 0.75;

			const write = (ss: Span[], opts: { x?: number; width?: number; size: number; bold?: boolean; italic?: boolean; color?: string }) => {
				const x = LEFT + pt(opts.x ?? 0);
				const width = pt(opts.width ?? CONTENT_W);
				let first = true;
				for (const s of ss) {
					doc
						.font(s.code ? "Courier" : s.bold || opts.bold ? "Helvetica-Bold" : s.italic || opts.italic ? "Helvetica-Oblique" : "Helvetica")
						.fontSize(pt(opts.size))
						.fillColor(s.href ? "#2563eb" : (opts.color ?? "#111"));
					doc.text(s.text, x, first ? absY(y) : undefined, { width, continued: s !== ss[ss.length - 1], ...(s.href ? { link: s.href, underline: true } : {}) });
					first = false;
				}
			};

			const render = (blocks: Block[]) => {
				for (const b of blocks) {
					switch (b.t) {
					case "heading": {
						const depth = Math.min(6, Math.max(1, b.depth));
						const size = SPEC.hSizes[depth - 1];
						const before = SPEC.hBefore[depth - 1];
						const h = measure(b.spans, size);
						fit(before + h + SPEC.hAfter);
						y += before;
						write(b.spans, { size, bold: true });
						y += h + SPEC.hAfter;
						break;
					}
					case "para": {
						const h = measure(b.spans, SPEC.body);
						fit(h + SPEC.paraAfter);
						write(b.spans, { size: SPEC.body });
						y += h + SPEC.paraAfter;
						break;
					}
					case "quote": {
						let used = SPEC.quoteBefore + SPEC.quoteAfter;
						for (const inner of b.blocks) if (inner.t === "para") used += measure(inner.spans, SPEC.body, CONTENT_W - SPEC.quoteIndent);
						fit(used); // quotes never split across pages
						y += SPEC.quoteBefore;
						for (const inner of b.blocks) {
							if (inner.t !== "para") {
								render([inner]);
								continue;
							}
							write(inner.spans, { size: SPEC.body, italic: true, color: "#555", x: SPEC.quoteIndent, width: CONTENT_W - SPEC.quoteIndent });
							y += measure(inner.spans, SPEC.body, CONTENT_W - SPEC.quoteIndent);
						}
						y += SPEC.quoteAfter;
						break;
					}
					case "list": {
						let i = 0;
						for (const item of b.items) {
							for (const inner of item) {
								if (inner.t !== "para") {
									render([inner]);
									continue;
								}
								const marker = b.ordered ? `${i + 1}.` : "\u2022";
								const spans = [{ text: `${marker}  ` }, ...inner.spans];
								const h = measure(spans, SPEC.body, CONTENT_W - SPEC.listIndent);
								fit(h + SPEC.listItemAfter);
								write(spans, { size: SPEC.body, x: SPEC.listIndent, width: CONTENT_W - SPEC.listIndent });
								y += h + SPEC.listItemAfter;
							}
							i++;
						}
						y += SPEC.listAfter;
						break;
					}
					case "code": {
						const innerW = CONTENT_W - 2 * SPEC.codePadX;
						const h = doc.font("Courier").fontSize(pt(SPEC.codeFont)).heightOfString(b.text, { width: pt(innerW) }) / 0.75 + 2 * SPEC.codePadY;
						fit(h + SPEC.codeAfter); // code blocks never split across pages
						doc.rect(LEFT + pt(-SPEC.codePadX), absY(y - SPEC.codePadY), pt(CONTENT_W + 2 * SPEC.codePadX), pt(h)).fill("#f4f4f4");
						doc.font("Courier").fontSize(pt(SPEC.codeFont)).fillColor("#333").text(b.text, LEFT + pt(SPEC.codePadX), absY(y + SPEC.codePadY), { width: pt(innerW) });
						y += h + SPEC.codeAfter;
						break;
					}
					case "table": {
						const cols = Math.max(1, b.header.length);
						const colW = CONTENT_W / cols;
						const cellTextW = colW - 2 * SPEC.tablePadX;
						const rowH = (cells: Span[][], head: boolean) =>
								Math.max(...cells.map((c) => doc.font(head ? "Helvetica-Bold" : "Helvetica").fontSize(pt(SPEC.tableFont)).heightOfString(plain(c), { width: pt(cellTextW) }) / 0.75)) + 2 * SPEC.tablePadY;
						const total = rowH(b.header, true) + b.rows.reduce((n, r) => n + rowH(r, false), 0);
						fit(total + SPEC.tableAfter); // tables never split across pages
						const rowOf = (cells: Span[][], head: boolean) => {
							const rowHeight = rowH(cells, head);
							if (head) doc.rect(LEFT, absY(y), CW, pt(rowHeight)).fill("#efeadd");
							cells.forEach((c, ci) => {
								doc.rect(LEFT + pt(ci * colW), absY(y), pt(colW), pt(rowHeight)).lineWidth(0.5).strokeColor("#bbb").stroke();
								write(c, { size: SPEC.tableFont, bold: head, x: ci * colW + SPEC.tablePadX, width: cellTextW });
							});
							y += rowHeight;
						};
						rowOf(b.header, true);
						for (const r of b.rows) rowOf(r, false);
						y += SPEC.tableAfter;
						break;
					}
					case "hr":
						fit(SPEC.hrBefore + SPEC.hrAfter);
						doc.moveTo(LEFT, absY(y + SPEC.hrBefore)).lineTo(LEFT + CW, absY(y + SPEC.hrBefore)).lineWidth(1).strokeColor("#ccc").stroke();
						y += SPEC.hrBefore + SPEC.hrAfter;
						break;
					case "pagebreak":
						doc.addPage();
						y = 0;
						break;
				}
				}
			};

			// doc title on page 1, then flow
			doc.font("Helvetica-Bold").fontSize(pt(SPEC.title)).fillColor("#111");
			doc.text(title, LEFT, absY(0));
			y = doc.currentLineHeight() / 0.75 + SPEC.titleAfter;
			render(parseBlocks(md));
			doc.end();
		} catch (e) {
			reject(e);
			}
	});
}
