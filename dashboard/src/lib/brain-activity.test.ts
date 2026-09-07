import { expect, test } from "bun:test";
import { normalizeBrainTools } from "./brain-activity";

test("normalizeBrainTools passes strings through", () => {
	expect(normalizeBrainTools(["query", "get_entity"])).toEqual(["query", "get_entity"]);
});

test("normalizeBrainTools folds {tool, c} objects (legacy brains)", () => {
	expect(normalizeBrainTools([{ tool: "query", c: 3 }, { tool: "lint_voice_text", c: 1 }])).toEqual([
		"query×3",
		"lint_voice_text",
	]);
});

test("normalizeBrainTools survives junk", () => {
	expect(normalizeBrainTools(undefined as never)).toEqual([]);
	expect(normalizeBrainTools([42, null, { tool: "x" }])).toEqual(["42", "null", "x"]);
});
