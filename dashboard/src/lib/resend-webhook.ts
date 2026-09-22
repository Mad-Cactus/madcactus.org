// Svix webhook signature verification (the scheme Resend uses) — pure crypto,
// no db, so the deduping receiver in /api/webhooks/resend stays thin and the
// check is unit-testable.
import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_S = 5 * 60;

export function verifySvixSignature(
	id: string,
	timestamp: string,
	body: string,
	signaturesCsv: string,
	secret: string,
): boolean {
	const age = Math.abs(Date.now() / 1000 - Number(timestamp));
	if (!Number.isFinite(age) || age > TOLERANCE_S) return false;
	const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
	const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
	// svix-signature holds space-separated "v1,<sig>" entries — any match wins
	return signaturesCsv.split(" ").some((entry) => {
		const sig = entry.replace(/^v1,/, "");
		if (sig.length !== expected.length) return false;
		return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
	});
}

export function signSvix(id: string, timestamp: string, body: string, secret: string): string {
	const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
	return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}
