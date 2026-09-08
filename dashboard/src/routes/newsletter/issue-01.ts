// Old issue-01 URL (was a hand-built static page; the issue now lives in the
// DB). 302 to the live DB issue so inbound links and SEO survive.
import type { APIEvent } from "@solidjs/start/server";
import { listPublishedDispatch } from "~/lib/dispatch";

export const GET = async (_event: APIEvent) => {
	const issues = await listPublishedDispatch();
	return new Response(null, {
		status: 302,
		headers: { Location: issues[0] ? `/newsletter/${issues[0].id}` : "/newsletter" },
	});
};
