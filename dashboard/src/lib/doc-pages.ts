// Client-side pager: visually splits the single flowing editor into letter
// pages that match the PDF export (same SPEC, same never-split-a-block rule).
// How: measure each top-level block in the REAL rendered flow (margins zeroed),
// simulate page filling, then give any block that would cross a page boundary a
// margin-top push that lands it at the top of the next page. Sheets + page
// numbers are absolutely-positioned overlays behind the text.
// Margin-top pushes collapse with the previous block's margin-bottom, so the
// push is pre-compensated: mt = push + prevGap (see comment at use site).
import { SPEC, CONTENT_H } from "~/lib/page-spec";

export function layoutPages(pager: HTMLElement, title: HTMLElement | null, editorRoot: HTMLElement): number {
	const blocks: HTMLElement[] = [];
	if (title) blocks.push(title);
	for (const n of Array.from(editorRoot.childNodes)) if (n instanceof HTMLElement) blocks.push(n);

	// zero previous pushes before measuring the natural flow
	for (const b of blocks) b.style.removeProperty("margin-top");
	if (!blocks.length) return 1;

	const pagerTop = pager.getBoundingClientRect().top;
	let vY = 0; // px used in the current page's content area
	let page = 0;
	let prevGap = 0; // previous block's margin-bottom

	for (const b of blocks) {
		const r = b.getBoundingClientRect();
		const h = r.height;
		const gap = parseFloat(getComputedStyle(b).marginBottom) || 0;

		if (b.classList.contains("doc-pagebreak")) {
			// hard break: divider stays put, next block starts a fresh page
			vY += h + gap;
			page++;
			vY = 0;
			prevGap = gap;
			continue;
		}

		if ((vY > 0 || page > 0) && vY + h > CONTENT_H) {
			page++;
			vY = 0;
		}

		const targetTop = page * (SPEC.pageH + SPEC.gap) + SPEC.pad + vY;
		const naturalTop = r.top - pagerTop;
		const push = targetTop - naturalTop;
		if (push > 0.5) {
			// rendered gap = max(prevGap, mt) once mt is set, so add prevGap to mt
			// to land exactly at naturalTop + push
			b.style.marginTop = `${(push + prevGap).toFixed(2)}px`;
		}

		vY += h + gap;
		prevGap = gap;
	}

	// rebuild sheet overlays + page numbers
	pager.querySelectorAll(".doc-sheet").forEach((s) => s.remove());
	const pages = page + 1;
	for (let i = 0; i < pages; i++) {
		const sheet = document.createElement("div");
		sheet.className = "doc-sheet";
		sheet.style.top = `${i * (SPEC.pageH + SPEC.gap)}px`;
		const num = document.createElement("div");
		num.className = "doc-sheet-num";
		num.textContent = String(i + 1);
		sheet.appendChild(num);
		pager.appendChild(sheet);
	}
	pager.style.minHeight = `${pages * (SPEC.pageH + SPEC.gap) - SPEC.gap}px`;
	return pages;
}
