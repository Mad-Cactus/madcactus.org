import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import { solidStart } from "@solidjs/start/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [
		solidStart(),
		// static marketing pages — prerendered at build. Requires the build to
		// run under Bun (bun --bun vite build): nitro's prerenderer executes in
		// worker_threads of the CURRENT runtime, and db/index.ts needs Bun SQL.
		// /newsletter and /newsletter/:id stay SSR (live DB archive + issues).
		nitro({ prerender: { crawlLinks: false, routes: ["/", "/scorecard", "/iu"] } }),
	],
  // `bun` is a runtime builtin on the oven/bun image (API routes use Bun.$);
  // keep the bundler from trying to resolve it.
  build: { rolldownOptions: { external: ["bun"] } },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
