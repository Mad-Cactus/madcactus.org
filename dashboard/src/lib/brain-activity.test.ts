import assert from "node:assert";
import { test } from "bun:test";
import { normalizeBrainTools } from "./brain-activity";

test("normalizeBrainTools passes strings through", () => {
	assert.deepEqual(normalizeBrainTools(["query", "get_entity"]), ["query", "get_entity"]);
});

test("normalizeBrainTools folds {tool, c} objects (legacy brains)", () => {
	assert.deepEqual(normalizeBrainTools([{ tool: "query", c: 3 }, { tool: "lint_voice_text", c: 1 }]), [
		"query×3",
		"lint_voice_text",
	]);
});

test("normalizeBrainTools survives junk", () => {
	assert.deepEqual(normalizeBrainTools(undefined as never), []);
	assert.deepEqual(normalizeBrainTools([42, null, { tool: "x" }]), ["42", "null", "x"]);
});
