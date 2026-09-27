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

// ── @[kind:id] mentions ────────────────────────────────────────────
import { $convertToMarkdownString } from "@lexical/markdown";
import { $isElementNode, type LexicalNode } from "lexical";
import { MentionNode, $isMentionNode } from "~/lib/doc-markdown";

// all mention chips in the current editor state (root walk — decorators
// aren't text nodes, so getAllTextNodes misses them)
const mentionsIn = (ed: ReturnType<typeof setup>): MentionNode[] => {
	const out: MentionNode[] = [];
	ed.read(() => {
		const walk = (n: LexicalNode) => {
			if ($isMentionNode(n)) out.push(n);
			else if ($isElementNode(n)) n.getChildren().forEach(walk);
		};
		walk($getRoot() as LexicalNode);
	});
	return out;
};

const exportMd = (ed: ReturnType<typeof setup>) => {
	let md = "";
	ed.read(() => (md = $convertToMarkdownString(DOC_TRANSFORMERS)));
	return md;
};

test("mention round-trip: @[video:x] → node → identical markdown", () => {
	const md = "Watch @[video:3fb8c1a2-9c4d-4a1b-b2e3-111122223333] before replying.";
	const ed = setup(md);
	const nodes = mentionsIn(ed);
	expect(nodes.length).toBe(1);
	expect($isMentionNode(nodes[0])).toBe(true);
	expect(nodes[0].getTextContent()).toBe("@video:3fb8c1a2-9c4d-4a1b-b2e3-111122223333");
	expect(exportMd(ed)).toBe(md);
});

test("mention in a list item round-trips inline", () => {
	const md = "- prep for @[prospect:aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000]\n- send email";
	const ed = setup(md);
	expect(mentionsIn(ed).length).toBe(1);
	expect(exportMd(ed)).toBe(md);
});

test("multiple mentions + unknown kind (stays raw text)", () => {
	const md = "see @[video:11111111-2222-3333-4444-555555555555] and @[company:99999999-8888-7777-6666-555555555555]";
	const ed = setup(md);
	expect(mentionsIn(ed).length).toBe(2);
	expect(exportMd(ed)).toBe(md);
	// unknown kinds still chip-ify (they render "missing"), and the markdown
	// round-trip stays byte-identical either way — web render + link sync are
	// the layers that skip unknown kinds
	const ed2 = setup("future @[quantum:thing] here");
	expect(exportMd(ed2)).toBe("future @[quantum:thing] here");
});

test("mention clone/importJSON keeps kind+id", () => {
	const ed = setup("@[doc:abcdef01-2345-6789-abcd-ef0123456789]");
	const [node] = mentionsIn(ed);
	const json = node.exportJSON();
	// node construction needs an active editor AND a writable context
	let clonedKind = "", clonedId = "", importedKind = "", importedId = "";
	ed.update(() => {
		const cloned = MentionNode.clone(node);
		clonedKind = cloned.__kind;
		clonedId = cloned.__id;
		const imported = MentionNode.importJSON(json);
		importedKind = imported.__kind;
		importedId = imported.__id;
	}, { discrete: true });
	expect(clonedKind).toBe("doc");
	expect(clonedId).toBe("abcdef01-2345-6789-abcd-ef0123456789");
	expect(importedKind).toBe("doc");
	expect(importedId).toBe("abcdef01-2345-6789-abcd-ef0123456789");
});
