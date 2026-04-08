FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app
COPY package.json turbo.json tsconfig.base.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/boardroom-ai/package.json packages/boardroom-ai/

RUN pnpm install --frozen-lockfile

COPY packages/shared/ packages/shared/
COPY packages/boardroom-ai/ packages/boardroom-ai/
COPY docs/prompts/ docs/prompts/

# Build shared package explicitly first — pnpm workspace symlinks in Docker
# can prevent TypeScript from finding .d.ts files through node_modules resolution
# Remove stale .tsbuildinfo to prevent composite/incremental skipping emit
RUN cd packages/shared && rm -f tsconfig.tsbuildinfo && pnpm exec tsc \
    && ls dist/index.d.ts \
    && echo "Shared declarations verified"

# Ensure node_modules/@boardroom/shared resolves to the built package
RUN rm -rf node_modules/@boardroom/shared 2>/dev/null; \
    mkdir -p node_modules/@boardroom/shared && \
    cp packages/shared/package.json node_modules/@boardroom/shared/ && \
    cp -r packages/shared/dist node_modules/@boardroom/shared/dist

# Build boardroom-ai server (tsc) + client (vite)
RUN cd packages/boardroom-ai && pnpm exec tsc -p server/tsconfig.json && pnpm exec vite build --config client/vite.config.ts

# Use pnpm deploy to create standalone production bundle with real deps
# (pnpm workspace node_modules are symlinks that break in multi-stage builds)
RUN pnpm --filter @boardroom/boardroom-ai deploy /app/deploy-output --prod --legacy

FROM node:20-alpine AS runner

WORKDIR /app

# Copy production node_modules from pnpm deploy (real files, not symlinks)
COPY --from=builder /app/deploy-output/node_modules ./node_modules

# Copy built artifacts
COPY --from=builder /app/packages/boardroom-ai/dist ./dist
COPY --from=builder /app/packages/boardroom-ai/client/dist ./client/dist

# Overlay shared package (workspace dep bundled by pnpm deploy may lack dist)
COPY --from=builder /app/packages/shared/dist ./node_modules/@boardroom/shared/dist
COPY --from=builder /app/packages/shared/package.json ./node_modules/@boardroom/shared/package.json

COPY --from=builder /app/docs/prompts/ ./docs/prompts/

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/server/index.js"]
