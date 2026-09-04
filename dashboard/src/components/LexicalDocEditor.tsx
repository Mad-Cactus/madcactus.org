// Lexical rich-text editor wrapped for Solid — 100% vanilla Lexical (same
// editor + version macro uses; macro's app is Solid too, zero React).
// Loads markdown, autosaves markdown: $convertFrom/ToMarkdownString.
// Shortcuts mirror macro's DefaultShortcuts: ⌘⇧X strikethrough, ⌘E inline
// code, ⌘⇧H highlight, plus ⌘S save.
import { onCleanup, onMount, createEffect } from "solid-js";
import {
	createEditor,
	FORMAT_TEXT_COMMAND,
	KEY_DOWN_COMMAND,
	BEFORE_INPUT_COMMAND,
	COMMAND_PRIORITY_HIGH,
	$getSelection,
	$isRangeSelection,
} from "lexical";
import {
	$convertFromMarkdownString,
	$convertToMarkdownString,
	TRANSFORMERS,
} from "@lexical/markdown";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { CodeNode, CodeHighlightNode } from "@lexical/code";
import { LinkNode, AutoLinkNode } from "@lexical/link";

export const DOC_NODES = [
	HeadingNode,
	QuoteNode,
	ListNode,
	ListItemNode,
	CodeNode,
	CodeHighlightNode,
	LinkNode,
	AutoLinkNode,
];

export default function LexicalDocEditor(props: {
	markdown: string;
	onMarkdownChange: (md: string) => void;
	onSave?: (md: string) => void;
	readOnly?: boolean;
}) {
	let host!: HTMLDivElement;

	onMount(() => {
		const ed = createEditor({
			namespace: "madcactus-docs",
			nodes: DOC_NODES,
			editable: !props.readOnly,
			onError: (e) => console.error(e),
		});
		ed.setRootElement(host);
		// the JSX host must not carry contenteditable=false — Lexical manages the
		// attribute itself, and a stale "false" leaves the doc uneditable
		ed.setEditable(!props.readOnly);

		const currentMd = () => {
			let md = "";
			ed.read(() => {
				md = $convertToMarkdownString(TRANSFORMERS);
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
				$convertFromMarkdownString(md, TRANSFORMERS);
			});
		});

		// Autosave ~1.2s after typing stops (same cadence as the redline app).
		let timer: ReturnType<typeof setTimeout> | undefined;
		const offUpdate = ed.registerUpdateListener(() => {
			clearTimeout(timer);
			timer = setTimeout(() => props.onMarkdownChange(currentMd()), 1200);
		});

		// Lexical's built-in beforeinput handler preventDefaults the browser's
		// insertText and then drops it in this app's environment (verified live:
		// event arrives, state never changes, no error). Handling inserts ourselves
		// at HIGH priority — before the built-in EDITOR-priority handler — makes
		// typing work. Everything else (paste, delete, composition) falls through.
		const offBeforeInput = ed.registerCommand(
			BEFORE_INPUT_COMMAND,
			(event: InputEvent) => {
				if (event.inputType !== "insertText" || !event.data) return false;
				const data = event.data;
				event.preventDefault();
				ed.update(() => {
					const sel = $getSelection();
					if ($isRangeSelection(sel)) sel.insertText(data);
				});
				return true;
			},
			COMMAND_PRIORITY_HIGH,
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
			offBeforeInput();
			ed.setRootElement(null);
		});
	});

	return (
		<div
			ref={host}
			class="doc-editor"
			classList={{ readonly: !!props.readOnly }}
			// Lexical toggles contenteditable itself only on setEditable() CHANGES —
			// the app owns the initial attribute, and a missing/false one leaves the
			// doc permanently uneditable
			contenteditable={!props.readOnly}
			// Grammarly's beforeinput hijack silently eats every keystroke under
			// Lexical (event arrives, defaultPrevented, no text lands)
			data-gramm="false"
			data-gramm_editor="false"
		/>
	);
}
