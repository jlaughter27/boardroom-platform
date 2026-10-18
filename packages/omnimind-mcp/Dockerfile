FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app
COPY package.json turbo.json tsconfig.base.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/omnimind-mcp/package.json packages/omnimind-mcp/

RUN pnpm install --frozen-lockfile

COPY packages/shared/ packages/shared/
COPY packages/omnimind-mcp/ packages/omnimind-mcp/

# Build shared package explicitly first — pnpm workspace symlinks in Docker
# can prevent TypeScript from finding .d.ts files through node_modules resolution
# Remove stale .tsbuildinfo to prevent composite/incremental skipping emit
RUN cd packages/shared && rm -f tsconfig.tsbuildinfo && pnpm exec tsc \
    && ls dist/index.d.ts \
    && echo "Shared declarations verified"

# Ensure node_modules/@boardroom/shared resolves to the built package
# (pnpm workspace links may not resolve correctly in Docker)
RUN rm -rf node_modules/@boardroom/shared 2>/dev/null; \
    mkdir -p node_modules/@boardroom/shared && \
    cp packages/shared/package.json node_modules/@boardroom/shared/ && \
    cp -r packages/shared/dist node_modules/@boardroom/shared/dist

# Build omnimind-mcp (shared already built). tsconfig excludes tests/, so the
# vitest suites copied above are not compiled into dist.
RUN cd packages/omnimind-mcp && pnpm exec tsc \
    && ls dist/index.js dist/transports/http.js \
    && echo "omnimind-mcp build verified"

# Use pnpm deploy to create standalone production bundle with real deps
# (pnpm workspace node_modules are symlinks that break in multi-stage builds)
RUN pnpm --filter @boardroom/omnimind-mcp deploy /app/deploy-output --prod --legacy

FROM node:20-alpine AS runner

WORKDIR /app

# Copy production node_modules from pnpm deploy (real files, not symlinks)
COPY --from=builder /app/deploy-output/node_modules ./node_modules

# Copy built artifacts
COPY --from=builder /app/packages/omnimind-mcp/dist ./dist

# Overlay shared package (workspace dep bundled by pnpm deploy may lack dist)
COPY --from=builder /app/packages/shared/dist ./node_modules/@boardroom/shared/dist
COPY --from=builder /app/packages/shared/package.json ./node_modules/@boardroom/shared/package.json

COPY --from=builder /app/packages/omnimind-mcp/package.json ./package.json

# No prompts, no Prisma, no bash: the MCP server only talks HTTP to OmniMind.
# `node dist/index.js http` reads PORT (Railway injects it; default 3334) and
# listens without a host argument, i.e. on `::` (dual-stack) — reachable over
# Railway private networking and the public domain alike.
ENV NODE_ENV=production
EXPOSE 3334

# Docker-level liveness for compose / local runs. Railway uses railway.toml's
# healthcheckPath instead and ignores this. GET /health needs no auth and does
# not go through the DNS-rebinding guard, so a loopback probe always works.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3334}/health" >/dev/null 2>&1 || exit 1

CMD ["node", "dist/index.js", "http"]
