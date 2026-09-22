// The AI scorecard lead magnet is retired — /brain (the free custom company
// brain) is the one funnel. Old bookmarks and links 302 here, no lost traffic.
import type { APIEvent } from "@solidjs/start/server";

export const GET = async (_event: APIEvent) => {
	return new Response(null, { status: 302, headers: { Location: "/brain" } });
};
