// Markdown <-> Lexical config for docs: node registry, GFM pipe-table
// transformer, page-break marker (`<!-- pagebreak -->` → PageBreakNode → real
// page break in .docx/.pdf exports). Pure module — no solid, testable headless.
import {
	$convertFromMarkdownString,
	$convertToMarkdownString,
	HEADING,
	QUOTE,
	CHECK_LIST,
	UNORDERED_LIST,
	ORDERED_LIST,
	MULTILINE_ELEMENT_TRANSFORMERS,
	TEXT_FORMAT_TRANSFORMERS,
	TEXT_MATCH_TRANSFORMERS,
	type ElementTransformer,
} from "@lexical/markdown";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { CodeNode, CodeHighlightNode } from "@lexical/code";
import { LinkNode, AutoLinkNode } from "@lexical/link";
import {
	TableNode,
	TableRowNode,
	TableCellNode,
	TableCellHeaderStates,
	$createTableNode,
	$createTableRowNode,
	$createTableCellNode,
	$isTableNode,
	$isTableRowNode,
	$isTableCellNode,
} from "@lexical/table";
import {
	DecoratorNode,
	$isParagraphNode,
	$isTextNode,
	type LexicalNode,
	type EditorConfig,
	type SerializedElementNode,
} from "lexical";

// Page-break marker: a `<!-- pagebreak -->` line in the markdown becomes this
// node — a visible divider in the editor, a real page break in .docx/.pdf
// exports (the server parses the same token). Keyboard-selectable (arrows)
// and deletable with Backspace.
class PageBreakNode extends DecoratorNode<null> {
	static getType(): string {
		return "page-break";
	}
	static clone(node: PageBreakNode): PageBreakNode {
		return new PageBreakNode(node.__key);
	}
	static importJSON(): PageBreakNode {
		return $createPageBreakNode();
	}
	createDOM(_config: EditorConfig): HTMLElement {
		const div = document.createElement("div");
		div.className = "doc-pagebreak";
		div.setAttribute("data-lexical-decorator", "true");
		const label = document.createElement("span");
		label.textContent = "Page break — starts a new page in .docx / .pdf exports";
		div.appendChild(label);
		return div;
	}
	updateDOM(): false {
		return false;
	}
	decorate(): null {
		return null;
	}
	isInline(): false {
		return false;
	}
	isKeyboardSelectable(): boolean {
		return true;
	}
	exportJSON(): SerializedElementNode {
		return { children: [], direction: null, format: "", indent: 0, type: "page-break", version: 1 };
	}
}
const $createPageBreakNode = () => new PageBreakNode();
const $isPageBreakNode = (node: LexicalNode | null | undefined): node is PageBreakNode => node instanceof PageBreakNode;

const PAGEBREAK: ElementTransformer = {
	type: "element",
	dependencies: [PageBreakNode],
	export: (node) => ($isPageBreakNode(node) ? "<!-- pagebreak -->" : null),
	regExp: /^<!--\s*pagebreak\s*-->$/,
	triggerOnEnter: true,
	replace: (parentNode) => {
		const pb = $createPageBreakNode();
		parentNode.replace(pb);
		pb.selectNext();
	},
};

// GFM pipe tables — port of the playground TABLE transformer, adapted to
// DOC_TRANSFORMERS (upstream: lexical-playground MarkdownTransformers).
// Import: each `| a | b |` line becomes a row; a following divider row marks
// the header. Export: TableNode → pipe rows again (round-trip stable).
const TABLE_ROW_REG_EXP = /^(?:\|)(.+)(?:\|)\s?$/;

function isTableRowDivider(line: string): boolean {
	return line.includes("|") && line.includes("-") && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
}

function getTableColumnsSize(table: TableNode): number {
	const row = table.getFirstChild<TableRowNode>();
	return $isTableRowNode(row) ? row.getChildrenSize() : 0;
}

const $createTableCell = (textContent: string): TableCellNode => {
	textContent = textContent.replace(/\\n/g, "\n");
	const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
	$convertFromMarkdownString(textContent, DOC_TRANSFORMERS, cell);
	return cell;
};

const mapToTableCells = (textContent: string): TableCellNode[] | null => {
	const match = textContent.match(TABLE_ROW_REG_EXP);
	if (!match || !match[1]) return null;
	return match[1].split("|").map((text) => $createTableCell(text));
};

const TABLE: ElementTransformer = {
	type: "element",
	dependencies: [TableNode, TableRowNode, TableCellNode],
	export: (node: LexicalNode) => {
		if (!$isTableNode(node)) return null;
		const output: string[] = [];
		for (const row of node.getChildren()) {
			if (!$isTableRowNode(row)) continue;
			const rowOutput: string[] = [];
			let isHeaderRow = false;
			for (const cell of row.getChildren()) {
				if ($isTableCellNode(cell)) {
					rowOutput.push(
						$convertToMarkdownString(DOC_TRANSFORMERS, cell)
							.replace(/\n/g, "\\n")
							.trim(),
					);
					if (cell.__headerState === TableCellHeaderStates.ROW) isHeaderRow = true;
				}
			}
			output.push(`| ${rowOutput.join(" | ")} |`);
			if (isHeaderRow) output.push(`| ${rowOutput.map(() => "---").join(" | ")} |`);
		}
		return output.join("\n");
	},
	regExp: TABLE_ROW_REG_EXP,
	replace: (parentNode, _1, match) => {
		// divider line right after a row → mark that row as the header
		if (isTableRowDivider(match[0])) {
			const table = parentNode.getPreviousSibling();
			if (!$isTableNode(table)) return;
			const rows = table.getChildren<TableRowNode>();
			const lastRow = rows[rows.length - 1];
			if (!$isTableRowNode(lastRow)) return;
			lastRow.getChildren().forEach((cell) => {
				if ($isTableCellNode(cell)) cell.setHeaderStyles(TableCellHeaderStates.ROW, TableCellHeaderStates.ROW);
			});
			parentNode.remove();
			return;
		}

		const matchCells = mapToTableCells(match[0]);
		if (matchCells == null) return;

		const rows = [matchCells];
		let sibling = parentNode.getPreviousSibling();
		let maxCells = matchCells.length;

		while (sibling) {
			if (!$isParagraphNode(sibling)) break;
			if (sibling.getChildrenSize() !== 1) break;
			const firstChild = sibling.getFirstChild<LexicalNode>();
			if (!$isTextNode(firstChild)) break;
			const cells = mapToTableCells(firstChild.getTextContent());
			if (cells == null) break;
			maxCells = Math.max(maxCells, cells.length);
			rows.unshift(cells);
			const previousSibling = sibling.getPreviousSibling();
			sibling.remove();
			sibling = previousSibling;
		}

		const table = $createTableNode();
		for (const cells of rows) {
			const tableRow = $createTableRowNode();
			table.append(tableRow);
			for (let i = 0; i < maxCells; i++) tableRow.append(i < cells.length ? cells[i] : $createTableCell(""));
		}

		const previousSibling = parentNode.getPreviousSibling();
		if ($isTableNode(previousSibling) && getTableColumnsSize(previousSibling) === maxCells) {
			previousSibling.append(...table.getChildren());
			parentNode.remove();
		} else {
			parentNode.replace(table);
		}
		table.selectEnd();
	},
};

export const DOC_NODES = [
	HeadingNode,
	QuoteNode,
	ListNode,
	ListItemNode,
	CodeNode,
	CodeHighlightNode,
	LinkNode,
	AutoLinkNode,
	TableNode,
	TableRowNode,
	TableCellNode,
	PageBreakNode,
];



export const DOC_TRANSFORMERS = [
	HEADING,
	QUOTE,
	CHECK_LIST,
	UNORDERED_LIST,
	ORDERED_LIST,
	TABLE,
	PAGEBREAK,
	...MULTILINE_ELEMENT_TRANSFORMERS,
	...TEXT_FORMAT_TRANSFORMERS,
	...TEXT_MATCH_TRANSFORMERS,
];

