import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import { solidStart } from "@solidjs/start/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [solidStart(), nitro()],
  // `bun` is a runtime builtin on the oven/bun image (API routes use Bun.$);
  // keep the bundler from trying to resolve it.
  build: { rolldownOptions: { external: ["bun"] } },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
