# ═══ Builder: install + compile ═══
FROM oven/bun:1.4 AS builder
WORKDIR /app

COPY package.json bun.lock* bun.lockb* ./
# npmrc comes in as a BuildKit secret so the @aspectrr token never lands in a layer
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc bun install

COPY . .
RUN bun run build

# ═══ Runner: just the compiled output ═══
FROM oven/bun:1.4 AS runner
WORKDIR /app

# ffmpeg: re-encodes oversized meeting audio before Supabase upload
# (Free plan caps every storage object at 50MB globally) + splices meeting
# drafts in /admin/meetings.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/.output ./.output

# ponytail: nitro externals tracing copies loro-crdt's glue to
# .output/server/_libs/ but not its sibling wasm (loaded via
# readFileSync(join(__dirname, "loro_wasm_bg.wasm")) at runtime) ->
# ENOENT 500s on /admin/docs + /admin/email. Remove if nitro traces it.
COPY --from=builder /app/node_modules/loro-crdt/nodejs/loro_wasm_bg.wasm ./.output/server/_libs/

EXPOSE 3000
ENV HOST=0.0.0.0 PORT=3000 NODE_ENV=production

CMD ["bun", ".output/server/index.mjs"]
