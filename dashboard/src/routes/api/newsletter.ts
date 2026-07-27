import type { APIEvent } from "@solidjs/start/server";
import { Resend } from "resend";

export async function OPTIONS() {
	return new Response(null, {
		status: 204,
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
		},
	});
}

export async function POST(event: APIEvent) {
	const key = process.env.RESEND_API_KEY;
	if (!key) {
		return json({ error: "RESEND_API_KEY not configured" }, 500);
	}

	const body = await event.request.json().catch(() => ({}));
	const email = body?.email?.trim()?.toLowerCase();

	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return json({ error: "Valid email required" }, 400);
	}

	const resend = new Resend(key);
	const { data, error } = await resend.contacts.create({
		email,
		unsubscribed: false,
	});

	if (error) {
		// Duplicate email — treat as success
		if (error.name === "validation_error") {
			return json({ ok: true, message: "already_subscribed" });
		}
		return json({ error: "Failed to subscribe", detail: error.message }, 502);
	}

	return json({ ok: true, id: data?.id });
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
		},
	});
}
