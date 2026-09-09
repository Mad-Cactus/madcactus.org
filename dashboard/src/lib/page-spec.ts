// Shared page geometry + typography spec for the docs pager (editor) and the
// PDF exporter. BOTH sides derive every size from these px values so page
// breaks land in the same place (PDF: pt = px * 0.75; editor: px as-is).
// Letter @ 96dpi. Fonts: Arial in the browser ≡ Helvetica in pdfkit
// (metric-compatible), Courier New ≡ Courier.
// ponytail: parity is within a few px per page; a block landing exactly on a
// boundary can flip sides. Upgrade path: server-side measure via pdfkit and
// feed exact break offsets to the pager.
export const SPEC = {
	pageW: 816, // 8.5in @96dpi
	pageH: 1056, // 11in @96dpi
	pad: 85.33, // 64pt margins
	gap: 28, // visual gap between sheets (editor only — cosmetic)
	title: 29.33, // 22pt doc title
	titleAfter: 13.33, // 10pt
	body: 14.67, // 11pt
	lh: 0.925, // Helvetica ascent+descent (718+207)/1000 — pdfkit line height
	paraAfter: 9.33, // 7pt
	hSizes: [28, 21.33, 18, 16, 14.67, 14.67], // 21/16/13.5/12/11/11pt
	hBefore: [18.67, 18.67, 13.33, 13.33, 13.33, 13.33], // 14pt / 10pt
	hAfter: 4, // 3pt
	listItemAfter: 5.33, // 4pt
	listAfter: 5.33, // 4pt after the whole list
	listIndent: 8, // 6pt marker offset
	quoteBefore: 10.67, // 8pt
	quoteIndent: 18.67, // 14pt
	quoteAfter: 10.67,
	codeFont: 12, // 9pt
	codeLineGap: 0.0, // extra leading inside code blocks (pt)
	codePadX: 10.67, // rect is wider than text by 2*8pt/3… keep simple: symmetric
	codePadY: 5.33, // 4pt
	codeAfter: 10.67, // 8pt
	tableFont: 12.67, // 9.5pt
	tablePadX: 8, // 6pt
	tablePadY: 5.33, // 4pt
	tableAfter: 10.67, // 8pt
	hrBefore: 10.67, // 8pt (padding-top on the hr)
	hrAfter: 18.67, // 14pt
} as const;

export const pt = (px: number) => px * 0.75;
export const CONTENT_W = SPEC.pageW - 2 * SPEC.pad; // 645.34
export const CONTENT_H = SPEC.pageH - 2 * SPEC.pad; // 885.34
