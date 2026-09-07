/// <reference types="@solidjs/start/env" />
declare module "pdfkit";

// injected by the PostHog snippets (entry-server + MarketingPage)
declare global {
	interface Window {
		posthog?: { init: (...a: unknown[]) => void; capture: (event: string, props?: Record<string, unknown>) => void };
	}
	const posthog: Window["posthog"];
}
export {};
