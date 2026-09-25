// Self-check for $isAtEmptyListItemStart — the Backspace-exits-list guard in
// LexicalDocEditor (DELETE_CHARACTER_COMMAND handler). Run: bun test src/lib/doc-markdown.test.ts
import { test, expect } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { INSERT_PARAGRAPH_COMMAND, $getRoot, $getSelection, $isRangeSelection, $isTextNode } from "lexical";
import { registerList } from "@lexical/list";
import { registerRichText } from "@lexical/rich-text";
import { DOC_NODES, DOC_TRANSFORMERS, $isAtEmptyListItemStart } from "~/lib/doc-markdown";

const setup = (md: string) => {
	const ed = createHeadlessEditor({ nodes: DOC_NODES, onError: (e) => { throw e; } });
	registerList(ed);
	registerRichText(ed);
	ed.update(() => $convertFromMarkdownString(md, DOC_TRANSFORMERS), { discrete: true });
	return ed;
};
const selectEndOf = (ed: ReturnType<typeof setup>, text: string) =>
	ed.update(() => {
		const t = $getRoot().getAllTextNodes().find((n) => n.getTextContent() === text)!;
		t.selectEnd();
	}, { discrete: true });

test("fresh empty item (element anchor): true — Backspace exits the list", () => {
	const ed = setup("1. one\n2. two\n");
	selectEndOf(ed, "two");
	ed.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined); // Enter → empty "3."
	ed.update(() => {}, { discrete: true });
	let v = false;
	ed.read(() => (v = $isAtEmptyListItemStart($getSelection())));
	expect(v).toBe(true);
});

test("start of an item WITH text: false — stock merge stays", () => {
	const ed = setup("1. one\n2. two\n");
	ed.update(() => {
		const t = $getRoot().getAllTextNodes().find((n) => n.getTextContent() === "two")!;
		t.selectStart();
	}, { discrete: true });
	let v = true;
	ed.read(() => (v = $isAtEmptyListItemStart($getSelection())));
	expect(v).toBe(false);
});

test("empty paragraph: false — Backspace merge unchanged", () => {
	const ed = setup("1. one\n2. two\n\n\n");
	selectEndOf(ed, "two");
	ed.update(() => {
		const paras = $getRoot().getChildren();
		paras[paras.length - 1].selectStart();
	}, { discrete: true });
	let v = true;
	ed.read(() => (v = $isAtEmptyListItemStart($getSelection())));
	expect(v).toBe(false);
});

test("whitespace-only item: true — shift+enter debris still exits", () => {
	const ed = setup("1. one\n2. two\n");
	selectEndOf(ed, "two");
	ed.update(() => {
		const s = $getSelection();
		if ($isRangeSelection(s)) s.insertLineBreak(); // shift+enter leaves \n
	}, { discrete: true });
	ed.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
	ed.update(() => {}, { discrete: true });
	let v = false;
	ed.read(() => (v = $isAtEmptyListItemStart($getSelection())));
	expect(v).toBe(true);
});
