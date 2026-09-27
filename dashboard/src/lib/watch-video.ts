"use server";

import { getVideoForWatch } from "~/lib/videos";

/** Public watch-page lookup (read-only; opens are beaconed by v-watch.js). */
export async function getTrackedVideo(id: string) {
	return getVideoForWatch(id);
}
