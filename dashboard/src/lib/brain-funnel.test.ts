// Tests for the /brain funnel edges: Resend webhook signature gate (401/403
// paths — the dedup itself is the resend_events unique index, exercised by
// insert-first in the route) and brain-request validation (400/honeypot paths
// — the insert needs a real DB, out of scope for this suite).
import { describe, expect, test } from "bun:test";
import { signSvix, verifySvixSignature } from "./resend-webhook";
import { POST as resendWebhook } from "../routes/api/webhooks/resend";
import { POST as brainRequest } from "../routes/api/brain-request";

const SECRET = "whsec_" + Buffer.from("test-secret-key").toString("base64");
const body = JSON.stringify({ type: "email.opened", data: { broadcast_id: "b" } });
const ts = String(Math.floor(Date.now() / 1000));

describe("svix signature verification", () => {
	test("valid signature passes", () => {
		const sig = signSvix("msg_1", ts, body, SECRET);
		expect(verifySvixSignature("msg_1", ts, body, sig, SECRET)).toBe(true);
	});

	test("tampered body fails", () => {
		const sig = signSvix("msg_1", ts, body, SECRET);
		expect(verifySvixSignature("msg_1", ts, body + " ", sig, SECRET)).toBe(false);
	});

	test("wrong secret fails", () => {
		const sig = signSvix("msg_1", ts, body, SECRET);
		expect(verifySvixSignature("msg_1", ts, body, sig, "whsec_" + Buffer.from("other").toString("base64"))).toBe(false);
	});

	test("stale timestamp (replay) fails", () => {
		const old = String(Math.floor(Date.now() / 1000) - 3600);
		const sig = signSvix("msg_1", old, body, SECRET);
		expect(verifySvixSignature("msg_1", old, body, sig, SECRET)).toBe(false);
	});
});

describe("resend webhook route gate", () => {
	const req = (headers: Record<string, string>, payload = body) =>
		new Request("http://x/api/webhooks/resend", { method: "POST", body: payload, headers });

	test("missing headers → 401 before anything else", async () => {
		delete process.env.RESEND_WEBHOOK_SECRET;
		const res = await resendWebhook({ request: req({}) } as never);
		expect(res.status).toBe(401);
	});

	test("bad signature → 403", async () => {
		process.env.RESEND_WEBHOOK_SECRET = SECRET;
		const res = await resendWebhook({
			request: req({ "svix-id": "m1", "svix-timestamp": ts, "svix-signature": "v1,bogus" }),
		} as never);
		expect(res.status).toBe(403);
	});
});

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
