// Lexical rich-text editor wrapped for Solid — 100% vanilla Lexical (same
// editor + version macro uses; macro's app is Solid too, zero React).
// Loads markdown, autosaves markdown: $convertFrom/ToMarkdownString.
// Live markdown while typing (like macro docs): "# " → heading, "- " → list,
// "- [ ] " → checkbox, "> " → quote, **bold**, `code`, via
// registerMarkdownShortcuts. A floating format toolbar shows on selection,
// mirroring macro's selection toolbar.
// Node registry + markdown transformers (GFM tables, page breaks) live in
// ~/lib/doc-markdown so they stay testable headless.
import { onCleanup, onMount, createEffect, createSignal, Show } from "solid-js";
import { DOC_NODES, DOC_TRANSFORMERS } from "~/lib/doc-markdown";
import { TableCellNode, TableRowNode, TableNode, $isTableNode, $createTableNode, $isTableCellNode, $isTableRowNode } from "@lexical/table";
import type { LexicalNode } from "lexical";
import { $convertFromMarkdownString, $convertToMarkdownString, registerMarkdownShortcuts } from "@lexical/markdown";
import {
	$getNearestNodeFromDOMNode,
	createEditor,
	FORMAT_TEXT_COMMAND,
	INSERT_PARAGRAPH_COMMAND,
	KEY_DOWN_COMMAND,
	KEY_ENTER_COMMAND,
	KEY_TAB_COMMAND,
	BEFORE_INPUT_COMMAND,
	SELECTION_CHANGE_COMMAND,
	COMMAND_PRIORITY_HIGH,
	COMMAND_PRIORITY_LOW,
	COMMAND_PRIORITY_EDITOR,
	type RangeSelection,
	type TextFormatType,
	$getSelection,
	$isRangeSelection,
	$createParagraphNode,
	$createTextNode,
} from "lexical";
import { registerRichText, $isHeadingNode, $isQuoteNode, $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode, INSERT_UNORDERED_LIST_COMMAND, registerList, $isListItemNode } from "@lexical/list";
import { registerHistory, createEmptyHistoryState } from "@lexical/history";
import { CodeNode, CodeHighlightNode, $isCodeNode } from "@lexical/code";
import { LinkNode, AutoLinkNode, TOGGLE_LINK_COMMAND, toggleLink } from "@lexical/link";
import { $setBlocksType } from "@lexical/selection";
import type { TableSplit } from "~/lib/doc-pages";

// CHECK_LIST converts on Enter (triggerOnEnter), so "- [ ] item" + Enter
// becomes a checkbox while "- " alone becomes a plain bullet on space —
// stock regexes, same arrangement as macro's docs editor.
type ToolbarApi = {
	fmt: (f: TextFormatType) => void;
	toggleH2: () => void;
	toggleQuote: () => void;
	bulletList: () => void;
	link: () => void;
};

/** What the pager (DocEditor.runLayout) can ask the editor to do. */
export type DocEditorApi = {
	root: HTMLElement;
	/** split crossing tables at row boundaries (page pagination); returns true when any split */
	splitTables: (splits: TableSplit[]) => boolean;
};

export default function LexicalDocEditor(props: {
	markdown: string;
	onMarkdownChange: (md: string) => void;
	onSave?: (md: string) => void;
	readOnly?: boolean;
	/** content changed — pager should re-measure (debounced by caller) */
	onLayoutDirty?: () => void;
	/** caret left the editor — pager reconciles frozen pushes */
	onBlur?: () => void;
	/** live pager API: root + break/sanitize operations (see DocEditorApi) */
	onReady?: (api: DocEditorApi) => void;
}) {
	let host!: HTMLDivElement;
	let api: ToolbarApi | undefined;
	const [tbShown, setTbShown] = createSignal(false);
	const [tbPos, setTbPos] = createSignal({ x: 0, y: 0 });
	const [tbFmt, setTbFmt] = createSignal({ bold: false, italic: false, strike: false, code: false, h2: false, quote: false });

	onMount(() => {
		const ed = createEditor({
			namespace: "madcactus-docs",
			nodes: DOC_NODES,
			editable: !props.readOnly,
			onError: (e) => console.error(e),
		});
		ed.setRootElement(host);

		// pager API — DocEditor.runLayout drives these
		const splitTables = (candidates: TableSplit[]): boolean => {
			let any = false;
			for (const { el, avail } of candidates) {
				const rows = Array.from(el.querySelectorAll("tr"));
				if (rows.length < 2) continue;
				// find how many leading rows fit in `avail` px (keep at least one)
				let acc = 0;
				let cut = 0;
				for (const r of rows) {
					const h = r.getBoundingClientRect().height;
					if (acc + h > avail && cut > 0) break;
					acc += h;
					cut++;
				}
				if (cut === 0 || cut >= rows.length || acc > avail) continue;
				ed.update(
					() => {
						const table = $getNearestNodeFromDOMNode(el);
						if (!$isTableNode(table)) return;
						const allRows = table.getChildren().filter($isTableRowNode);
						const moved = allRows.slice(cut);
						if (!moved.length) return;
						const rest = $createTableNode();
						for (const r of moved) rest.append(r);
						table.insertAfter(rest);
						any = true;
					},
					// discrete: commit + reconcile synchronously so the pager can
					// re-measure in the same pass; history-merge: the split rides
					// the paste's undo entry instead of its own
					{ discrete: true, tag: "history-merge" },
				);
			}
			return any;
		};

		props.onReady?.({ root: host, splitTables });
		// the JSX host must not carry contenteditable=false — Lexical manages the
		// attribute itself, and a stale "false" leaves the doc uneditable
		ed.setEditable(!props.readOnly);
		registerMarkdownShortcuts(ed, DOC_TRANSFORMERS);
		// Vanilla Lexical ships commands without implementations — the React
		// plugins normally register these. Solid app: register them ourselves.
		// registerRichText: paste (PASTE_COMMAND), select-all (SELECT_ALL),
		// copy/cut, and the delete/format/insert-paragraph impls.
		// registerHistory: UNDO/REDO impls so ⌘Z / ⇧⌘Z work — core's keydown
		// handler dispatches those commands; without registration they no-op.
		registerList(ed);
		registerRichText(ed);
		registerHistory(ed, createEmptyHistoryState(), 1000);
		ed.registerCommand(
			TOGGLE_LINK_COMMAND,
			(url) => {
				ed.update(() => {
					toggleLink(url as string);
				});
				return true;
			},
			COMMAND_PRIORITY_EDITOR,
		);

		const currentMd = () => {
			let md = "";
			ed.read(() => {
				md = $convertToMarkdownString(DOC_TRANSFORMERS);
			});
			return md;
		};

		// seed + react to markdown prop changes; skip when the change came from
		// our own typing (md equals what's already in the editor) so we never
		// clobber the user's in-flight edits
		createEffect(() => {
			const md = props.markdown;
			if (md === currentMd()) return;
			ed.update(() => {
				$convertFromMarkdownString(md, DOC_TRANSFORMERS);
			});
		});

		// Autosave ~1.2s after typing stops.
		let timer: ReturnType<typeof setTimeout> | undefined;
		const offUpdate = ed.registerUpdateListener(() => {
			syncToolbar();
			props.onLayoutDirty?.();
			clearTimeout(timer);
			timer = setTimeout(() => props.onMarkdownChange(currentMd()), 1200);
		});

		// Floating selection toolbar, macro-style.
		const syncToolbar = () => {
			let show = false;
			let x = 0;
			let y = 0;
			let fmts = { bold: false, italic: false, strike: false, code: false, h2: false, quote: false };
			ed.getEditorState().read(() => {
				const s = $getSelection();
				if (!$isRangeSelection(s) || s.isCollapsed() || props.readOnly) return;
				const dom = window.getSelection();
				if (!dom || dom.rangeCount === 0) return;
				const r = dom.getRangeAt(0).getBoundingClientRect();
				if (r.width === 0 && r.height === 0) return;
				show = true;
				x = Math.max(180, Math.min(r.left + r.width / 2, window.innerWidth - 180));
				y = Math.max(8, r.top - 46);
				const top = s.anchor.getNode().getTopLevelElement?.() ?? null;
				fmts = {
					bold: s.hasFormat("bold"),
					italic: s.hasFormat("italic"),
					strike: s.hasFormat("strikethrough"),
					code: s.hasFormat("code"),
					h2: $isHeadingNode(top) && top.getTag() === "h2",
					quote: $isQuoteNode(top),
				};
			});
			setTbShown(show);
			if (show) setTbPos({ x, y });
			setTbFmt(fmts);
		};
		const offSel = ed.registerCommand(
			SELECTION_CHANGE_COMMAND,
			() => {
				syncToolbar();
				return false;
			},
			COMMAND_PRIORITY_LOW,
		);
		const hideOnBlur = () => setTbShown(false);
		host.addEventListener("blur", hideOnBlur);
		host.addEventListener("scroll", hideOnBlur, true);

		// selection-flag reconcile (toggleFormat) doesn't reach the DOM in this
		// environment — formatText marks the nodes themselves dirty, which does.
		// formatText still toggles: it strips the format when all selected text
		// already has it.
		api = {
			fmt: (f) =>
				ed.update(() => {
					const sel = $getSelection();
					if ($isRangeSelection(sel)) sel.formatText(f);
				}),
			toggleH2: () =>
				ed.update(() => {
					const s = $getSelection();
					if (!$isRangeSelection(s)) return;
					const top = s.anchor.getNode().getTopLevelElement?.();
					if (top && $isHeadingNode(top) && top.getTag() === "h2") $setBlocksType(s, () => $createHeadingNode("h3"));
					else $setBlocksType(s, () => $createHeadingNode("h2"));
				}),
			toggleQuote: () =>
				ed.update(() => {
					const s = $getSelection();
					if (!$isRangeSelection(s)) return;
					const top = s.anchor.getNode().getTopLevelElement?.();
					if (top && $isQuoteNode(top)) $setBlocksType(s, $createParagraphNode);
					else $setBlocksType(s, $createQuoteNode);
				}),
			bulletList: () => ed.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
			link: () => {
				const url = window.prompt("Link URL");
				if (url) ed.dispatchCommand(TOGGLE_LINK_COMMAND, url);
			},
		};

		// Lexical's built-in beforeinput handler preventDefaults controlled input
		// events and then drops them in this app's environment (verified live: event
		// arrives, state never changes, no error — applies to insertText AND
		// insertParagraph and deletes). Handling them ourselves at HIGH priority —
		// before the built-in EDITOR-priority handler — makes typing work. Anything
		// exotic (IME composition, drag-drop) still falls through.
		const controlled = (apply: (s: RangeSelection) => void) => {
			ed.update(() => {
				const sel = $getSelection();
				if ($isRangeSelection(sel)) apply(sel);
			});
		};
		const offBeforeInput = ed.registerCommand(
			BEFORE_INPUT_COMMAND,
			(event: InputEvent) => {
				switch (event.inputType) {
					case "insertText": {
						if (!event.data) return false;
						const data = event.data;
						event.preventDefault();
						controlled((s) => s.insertText(data));
						return true;
					}
					case "insertParagraph":
					case "insertLineBreak": {
						event.preventDefault();
						if (event.inputType === "insertParagraph") {
							// Route through the command, not s.insertParagraph():
							// registerList's INSERT_PARAGRAPH handler (LOW priority)
							// unwraps an empty list item into a paragraph — Enter on
							// an empty "- " exits the bullet. s.insertParagraph()
							// copies the empty item instead, spawning endless bullets.
							ed.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
						} else {
							controlled((s) => s.insertLineBreak());
						}
						return true;
					}
					case "deleteContentBackward":
					case "deleteWordBackward":
					case "deleteContentForward": {
						event.preventDefault();
						controlled((s) => {
							if (event.inputType === "deleteContentForward") s.deleteCharacter(false);
							else if (event.inputType === "deleteWordBackward") s.deleteWord(true);
							else s.deleteCharacter(true);
						});
						return true;
					}
					default:
						return false;
				}
			},
			COMMAND_PRIORITY_HIGH,
		);

		// Enter on an empty last line of a code block exits the block (playground
		// behavior) — otherwise there is no way out from the end of a code block.
		ed.registerCommand(
			KEY_ENTER_COMMAND,
			(event: KeyboardEvent | null) => {
				const sel = $getSelection();
				if (!$isRangeSelection(sel) || !sel.isCollapsed()) return false;
				const anchor = sel.anchor.getNode();
				const code = $isCodeNode(anchor) ? anchor : $isCodeNode(anchor.getTopLevelElement?.()) ? (anchor.getTopLevelElement() as CodeNode) : null;
				if (!code || !code.getTextContent().endsWith("\n")) return false;
				if (event) event.preventDefault();
				ed.update(() => {
					const p = $createParagraphNode();
					code.insertAfter(p);
					p.selectStart();
				});
				return true;
			},
			COMMAND_PRIORITY_EDITOR,
		);

		// Tab / Shift+Tab move between table cells (0.45's applyTableHandlers
		// is internal-API shaped; this covers the navigation users expect)
		ed.registerCommand(
			KEY_TAB_COMMAND,
			(event: KeyboardEvent | null) => {
				const backwards = !!event?.shiftKey;
				let handled = false;
				ed.update(() => {
					const sel = $getSelection();
					if (!$isRangeSelection(sel)) return;
					let n: LexicalNode | null = sel.anchor.getNode();
					while (n && !$isTableCellNode(n)) n = n.getParent();
					if (!$isTableCellNode(n)) return;
					const row = n.getParent();
					if (!$isTableRowNode(row)) return;
					let next = backwards ? n.getPreviousSibling() : n.getNextSibling();
					if (!next) {
						const nextRow = backwards ? row.getPreviousSibling() : row.getNextSibling();
						if (!$isTableRowNode(nextRow)) return;
						next = backwards ? nextRow.getLastChild() : nextRow.getFirstChild();
					}
					if (next) {
						(event as KeyboardEvent | null)?.preventDefault();
						handled = true;
						(next as TableCellNode).selectStart();
					}
				});
				return handled;
			},
			COMMAND_PRIORITY_LOW,
		);

		// "- [ ] task" + Enter → checkbox. "- " already became a bullet on space
		// (stock UNORDERED_LIST), and stock CHECK_LIST can't fire inside an
		// existing list, so handle the Enter case ourselves — same arrangement
		// as macro's markdownShortcutsPlugin.
		ed.registerCommand(
			KEY_ENTER_COMMAND,
			(event: KeyboardEvent | null) => {
				const sel = $getSelection();
				if (!$isRangeSelection(sel) || !sel.isCollapsed()) return false;
				const anchor = sel.anchor.getNode();
				const li = $isListItemNode(anchor) ? anchor : $isListItemNode(anchor.getParent()) ? (anchor.getParent() as ListItemNode) : null;
				if (!li) return false;
				const list = li.getParent();
				if (!list || !("getListType" in list) || (list as ListNode).getListType() !== "bullet") return false;
				const m = /^\s*\[([xX ])\]\s?(.*)$/.exec(li.getTextContent());
				if (!m) return false;
				if (event) event.preventDefault();
				ed.update(() => {
					li.clear();
					const text = $createTextNode(m[2]);
					li.append(text);
					li.setChecked(m[1].toLowerCase() === "x");
					(list as ListNode).setListType("check");
					text.selectEnd();
				});
				return true;
			},
			COMMAND_PRIORITY_LOW,
		);

		// Macro-style format shortcuts + ⌘S save.
		const offKeys = ed.registerCommand(
			KEY_DOWN_COMMAND,
			(event: KeyboardEvent) => {
				if (!(event.metaKey || event.ctrlKey)) return false;
				if (event.key.toLowerCase() === "s") {
					event.preventDefault();
					props.onSave?.(currentMd());
					return true;
				}
				if (event.shiftKey && event.key.toLowerCase() === "x") {
					event.preventDefault();
					ed.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");
					return true;
				}
				if (event.shiftKey && event.key.toLowerCase() === "h") {
					event.preventDefault();
					ed.dispatchCommand(FORMAT_TEXT_COMMAND, "highlight");
					return true;
				}
				if (event.key.toLowerCase() === "e") {
					event.preventDefault();
					ed.dispatchCommand(FORMAT_TEXT_COMMAND, "code");
					return true;
				}
				return false;
			},
			4, // COMMAND_PRIORITY_HIGH
		);

		onCleanup(() => {
			clearTimeout(timer);
			offUpdate();
			offKeys();
			offSel();
			offBeforeInput();
			host.removeEventListener("blur", hideOnBlur);
			host.removeEventListener("scroll", hideOnBlur, true);
			ed.setRootElement(null);
		});
	});

 return (
		<>
			<div
				ref={host}
				class="doc-editor"
				classList={{ readonly: !!props.readOnly }}
				onBlur={() => props.onBlur?.()}
				// Lexical toggles contenteditable itself only on setEditable() CHANGES —
				// the app owns the initial attribute, and a missing/false one leaves the
				// doc permanently uneditable
				contenteditable={!props.readOnly}
				// Grammarly's beforeinput hijack silently eats every keystroke under
				// Lexical (event arrives, defaultPrevented, no text lands)
				data-gramm="false"
				data-gramm_editor="false"
			/>
			<Show when={!props.readOnly}>
				<div
					class="doc-toolbar"
					style={{ display: tbShown() ? "flex" : "none", top: `${tbPos().y}px`, left: `${tbPos().x}px` }}
					// preventDefault keeps the text selection alive when clicking buttons
					onMouseDown={(e) => e.preventDefault()}
				>
					<button type="button" title="Bold (⌘B)" classList={{ active: tbFmt().bold }} onClick={() => api?.fmt("bold")}>
						<b>B</b>
					</button>
					<button type="button" title="Italic (⌘I)" classList={{ active: tbFmt().italic }} onClick={() => api?.fmt("italic")}>
						<i>i</i>
					</button>
					<button type="button" title="Strikethrough (⌘⇧X)" classList={{ active: tbFmt().strike }} onClick={() => api?.fmt("strikethrough")}>
						<s>S</s>
					</button>
					<button type="button" title="Inline code (⌘E)" classList={{ active: tbFmt().code }} onClick={() => api?.fmt("code")}>
						{"</>"}
					</button>
					<button type="button" title="Heading" classList={{ active: tbFmt().h2 }} onClick={() => api?.toggleH2()}>
						H
					</button>
					<button type="button" title="Bullet list" onClick={() => api?.bulletList()}>
						•
					</button>
					<button type="button" title="Quote" classList={{ active: tbFmt().quote }} onClick={() => api?.toggleQuote()}>
						❝
					</button>
					<button type="button" title="Link" onClick={() => api?.link()}>
						↗
					</button>
				</div>
			</Show>
		</>
	);
}
