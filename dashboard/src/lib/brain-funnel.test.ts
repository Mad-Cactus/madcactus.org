// Tests for the /brain funnel edges: brain-request validation (400/honeypot
// paths — the insert needs a real DB, out of scope for this suite). Open/click
// tracking is native now: seal pixel (/api/track/open) + /l/?r={{email}} into
// short_link_clicks — no Resend webhook in the loop.
import { describe, expect, test } from "bun:test";
import { POST as brainRequest } from "../routes/api/brain-request";

describe("brain-request validation", () => {
	const call = (payload: Record<string, unknown>) =>
		brainRequest({
			request: new Request("http://x/api/brain-request", {
				method: "POST",
				body: JSON.stringify(payload),
				headers: { "Content-Type": "application/json", "x-forwarded-for": "10.0.0.9" },
			}),
		} as never);

	test("missing name/company → 400", async () => {
		expect((await call({ email: "a@b.co" })).status).toBe(400);
		expect((await call({ name: "A", company: " " })).status).toBe(400);
	});

	test("invalid email → 400", async () => {
		expect((await call({ name: "A", company: "B", email: "nope" })).status).toBe(400);
	});

	test("honeypot filled → silent ok, nothing stored", async () => {
		const res = await call({ website: "spam.example", name: "A", company: "B", email: "a@b.co" });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	test("malformed JSON → 400", async () => {
		const res = brainRequest({
			request: new Request("http://x", { method: "POST", body: "not json" }),
		} as never);
		expect((await res).status).toBe(400);
	});
});
