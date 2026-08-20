# ═══ Builder: install + compile ═══
FROM oven/bun:1 AS builder
WORKDIR /app

COPY package.json bun.lock* bun.lockb* ./
RUN bun install

COPY . .
RUN bun run build

# ═══ Runner: just the compiled output ═══
FROM oven/bun:1 AS runner
WORKDIR /app

# ffmpeg: meeting-publish audio splicing (admin/meetings)
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ffmpeg \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/.output ./.output

EXPOSE 3000
ENV HOST=0.0.0.0 PORT=3000 NODE_ENV=production

CMD ["bun", ".output/server/index.mjs"]
