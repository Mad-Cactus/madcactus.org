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
	type TextMatchTransformer,
} from "@lexical/markdown";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode, $isListItemNode } from "@lexical/list";
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
	$createParagraphNode,
	$createLineBreakNode,
	type LexicalNode,
	type BaseSelection,
	$isRangeSelection,
	type EditorConfig,
	type SerializedElementNode,
} from "lexical";

// Page-break marker: a `<!-- pagebreak -->` line in the markdown becomes this
// node — a visible divider in the editor, a real page break in .docx/.pdf
// exports (the server parses the same token). Keyboard-selectable (arrows)
// and deletable with Backspace.
export class PageBreakNode extends DecoratorNode<null> {
	static getType(): string {
		return "page-break";
	}
	static clone(node: PageBreakNode): PageBreakNode {
		return new PageBreakNode();
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
export const $isPageBreakNode = (node: LexicalNode | null | undefined): node is PageBreakNode => node instanceof PageBreakNode;

// Component mention: `@[kind:id]` in the markdown becomes this inline chip —
// a REFERENCE, not a copy. Label/status display live from the component
// registry (refreshed on doc open + edits via /api/components/card); the
// markdown only ever stores kind:id, so renames/status changes propagate to
// every mention. kind/id round-trip exactly; the label is display-only.
export type SerializedMentionNode = SerializedElementNode & {
	kind: string;
	id: string;
	label: string;
	status: string | null;
	missing: boolean;
};

export class MentionNode extends DecoratorNode<null> {
	__kind: string;
	__id: string;
	__label: string;
	__status: string | null;
	__missing: boolean;

	static getType(): string {
		return "mention";
	}
	static clone(node: MentionNode): MentionNode {
		return new MentionNode(node.__kind, node.__id, node.__label, node.__status, node.__missing, node.__key);
	}
	static importJSON(json: SerializedMentionNode): MentionNode {
		return $createMentionNode(json.kind, json.id, json.label, json.status, json.missing);
	}
	constructor(kind: string, id: string, label?: string, status: string | null = null, missing = false, key?: string) {
		super(key);
		this.__kind = kind;
		this.__id = id;
		this.__label = label ?? `${kind}:${id}`;
		this.__status = status;
		this.__missing = missing;
	}
	createDOM(_config: EditorConfig): HTMLElement {
		const span = document.createElement("span");
		span.className = this.__missing ? "doc-mention doc-mention-deleted" : "doc-mention";
		span.setAttribute("data-lexical-decorator", "true");
		span.setAttribute("contenteditable", "false");
		span.setAttribute("data-kind", this.__kind);
		span.setAttribute("data-id", this.__id);
		if (this.__status) span.setAttribute("data-status", this.__status);
		span.textContent = `@${this.__label}`;
		return span;
	}
	updateDOM(): false {
		return false;
	}
	decorate(): null {
		return null;
	}
	isInline(): boolean {
		return true;
	}
	// one Backspace deletes the whole chip; arrows select it first
	isIsolated(): boolean {
		return true;
	}
	isKeyboardSelectable(): boolean {
		return true;
	}
	getTextContent(): string {
		return `@${this.__label}`;
	}
	exportJSON(): SerializedMentionNode {
		return {
			children: [],
			direction: null,
			format: "",
			indent: 0,
			type: "mention",
			version: 1,
			kind: this.__kind,
			id: this.__id,
			label: this.__label,
			status: this.__status,
			missing: this.__missing,
		};
	}
}
const $createMentionNode = (kind: string, id: string, label?: string, status: string | null = null, missing = false) =>
	new MentionNode(kind, id, label, status, missing);
export const $isMentionNode = (node: LexicalNode | null | undefined): node is MentionNode => node instanceof MentionNode;

export const MENTION_SYNTAX_RE = /@\[([a-z0-9-]+):([a-z0-9-]+)\]/i;

const MENTION: TextMatchTransformer = {
	type: "text-match",
	dependencies: [MentionNode],
	export: (node) => ($isMentionNode(node) ? `@[${node.__kind}:${node.__id}]` : null),
	importRegExp: /@\[([a-z0-9-]+):([a-z0-9-]+)\]/,
	regExp: MENTION_SYNTAX_RE,
	replace: (textNode, match) => {
		// match[0] is the full @[kind:id]; label stays unknown until a card
		// fetch resolves it (chip renders kind:id until then)
		textNode.replace($createMentionNode(match[1], match[2]));
	},
};

/** True when a collapsed selection sits at the very start of an empty list
 *  item (no text, or whitespace/line-breaks only) — the state where Backspace
 *  should exit the list instead of merging into the previous item. Handles
 *  both anchor shapes Lexical produces on a fresh item (element-anchor on the
 *  ListItemNode, text-anchor on its child). */
export const $isAtEmptyListItemStart = (sel: BaseSelection | null | undefined): boolean => {
	if (!sel || !$isRangeSelection(sel) || !sel.isCollapsed() || sel.anchor.offset !== 0) return false;
	const n = sel.anchor.getNode();
	const li = $isListItemNode(n) ? n : $isListItemNode(n.getParent()) ? n.getParent() : null;
	return li !== null && li.getTextContent().trim() === "";
};

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

// Empty-paragraph marker: a Google-Docs blank line pastes in as an empty
// paragraph. Stock markdown export turns each into a bare `\n` line and
// import's cleanup deletes empty paragraphs — so a pasted doc tightened on
// every reload (never looked like the GDoc again). This transformer gives
// blank lines an explicit round-trippable token instead: same look after
// paste, save, and reload. Import appends a LineBreakNode so the paragraph
// survives createMarkdownImport's empty-paragraph sweep (only paragraphs
// whose single child is a text node get removed); `<p><br></p>` renders as
// one empty line — identical to the paste-time blank.
const BLANK: ElementTransformer = {
	type: "element",
	dependencies: [],
	export: (node) => ($isParagraphNode(node) && !node.getTextContent().trim() ? "<!-- blank -->" : null),
	regExp: /^<!--\s*blank\s*-->$/,
	replace: (parentNode) => {
		const p = $createParagraphNode();
		p.append($createLineBreakNode());
		parentNode.replace(p);
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
	MentionNode,
];



export const DOC_TRANSFORMERS = [
	HEADING,
	QUOTE,
	CHECK_LIST,
	UNORDERED_LIST,
	ORDERED_LIST,
	TABLE,
	PAGEBREAK,
	BLANK,
	MENTION,
	...MULTILINE_ELEMENT_TRANSFORMERS,
	...TEXT_FORMAT_TRANSFORMERS,
	...TEXT_MATCH_TRANSFORMERS,
];

