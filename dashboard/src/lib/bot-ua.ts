// Bot/prefetcher UA denylist — ported from company-brain server.ts BOT_UA.
// Link unfurlers (LinkedInBot, Slackbot, Twitterbot, Facebookexternalhit)
// and email-client prefetchers hit /l/ links without a human; headless
// scanners execute JS and fire the video open beacon. Same list guards both.
// ponytail: UA sniffing misses generic-browser prefetchers (Outlook safelink
// with a vanilla UA); if a link still shows inflated counts, add IP/dedup
// keying — don't grow this regex hunting them.
export const BOT_UA =
	/bot|crawl|spider|scrap|scan|curl|wget|python|headless|checker|monitor|censys|netcraft|palo alto|go-http|preview|facebookexternalhit|embed|validator|lighthouse|pagespeed|fetch/i;

/** True when the request's User-Agent looks non-human (missing UA = bot). */
export function isBotUA(userAgent: string | null): boolean {
	return !userAgent || BOT_UA.test(userAgent);
}
