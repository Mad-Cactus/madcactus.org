// Lexical rich-text editor wrapped for Solid — 100% vanilla Lexical (same
// editor + version macro uses; macro's app is Solid too, zero React).
// Loads markdown, autosaves markdown: $convertFrom/ToMarkdownString.
// Shortcuts mirror macro's DefaultShortcuts: ⌘⇧X strikethrough, ⌘E inline
// code, ⌘⇧H highlight, plus ⌘S save.
import { onCleanup, onMount } from "solid-js";
import {
	createEditor,
	FORMAT_TEXT_COMMAND,
	KEY_DOWN_COMMAND,
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

		ed.update(() => {
			$convertFromMarkdownString(props.markdown, TRANSFORMERS);
		});

		const currentMd = () => {
			let md = "";
			ed.read(() => {
				md = $convertToMarkdownString(TRANSFORMERS);
			});
			return md;
		};

		// Autosave ~1.2s after typing stops (same cadence as the redline app).
		let timer: ReturnType<typeof setTimeout> | undefined;
		const offUpdate = ed.registerUpdateListener(() => {
			clearTimeout(timer);
			timer = setTimeout(() => props.onMarkdownChange(currentMd()), 1200);
		});

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
			ed.setRootElement(null);
		});
	});

	return (
		<div
			ref={host}
			class="doc-editor"
			classList={{ readonly: !!props.readOnly }}
			contenteditable={false}
		/>
	);
}
