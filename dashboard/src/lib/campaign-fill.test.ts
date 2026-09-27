import { describe, expect, test } from "bun:test";
import { fillTemplate, templateSlots } from "./campaign-fill";

describe("fillTemplate", () => {
	test("fills known slots", () => {
		expect(fillTemplate("Hi {{first_name}} at {{company}}", { first_name: "Steve", company: "Acme" })).toBe("Hi Steve at Acme");
	});
	test("leaves unknown slots visible", () => {
		expect(fillTemplate("Hi {{first_name}} — {{finding_1}}", { first_name: "Steve" })).toBe("Hi Steve — {{finding_1}}");
	});
	test("case-insensitive slot names, trimmed braces", () => {
		expect(fillTemplate("{{ FirstName }}", { firstname: "Ann" })).toBe("Ann");
	});
	test("no slots → unchanged", () => {
		expect(fillTemplate("plain text", {})).toBe("plain text");
	});
});

describe("templateSlots", () => {
	test("distinct lowercase in first-use order", () => {
		expect(templateSlots("{{company}} {{link}} {{Company}}")).toEqual(["company", "link"]);
	});
	test("empty when none", () => {
		expect(templateSlots("no tokens")).toEqual([]);
	});
});
