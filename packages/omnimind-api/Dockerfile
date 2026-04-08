FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app
COPY package.json turbo.json tsconfig.base.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/omnimind-api/package.json packages/omnimind-api/

RUN pnpm install --frozen-lockfile

COPY packages/shared/ packages/shared/
COPY packages/omnimind-api/ packages/omnimind-api/

# Generate Prisma client BEFORE TypeScript build (needs the generated types)
RUN cd packages/omnimind-api && pnpm exec prisma generate

# Copy generated .prisma client to a stable path for the runner stage
# (pnpm stores it deep in .pnpm virtual store with version-specific paths)
RUN find /app/node_modules/.pnpm -path '*/.prisma/client/index.js' -exec dirname {} \; | head -1 | \
    xargs -I{} cp -rL {}/.. /app/prisma-client-generated

# Copy Prisma CLI + engines to stable path (devDep not in prod deploy)
RUN cp -rL /app/node_modules/.pnpm/prisma@*/node_modules/prisma /app/prisma-cli && \
    cp -rL /app/node_modules/.pnpm/@prisma+engines@*/node_modules/@prisma/engines /app/prisma-engines

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

# Build omnimind-api (shared already built, turbo will skip it)
RUN cd packages/omnimind-api && pnpm exec tsc

# Use pnpm deploy to create standalone production bundle with real deps
# (pnpm workspace node_modules are symlinks that break in multi-stage builds)
RUN pnpm --filter @boardroom/omnimind-api deploy /app/deploy-output --prod --legacy

FROM node:20-alpine AS runner

WORKDIR /app

# Copy production node_modules from pnpm deploy (real files, not symlinks)
COPY --from=builder /app/deploy-output/node_modules ./node_modules

# Copy built artifacts
COPY --from=builder /app/packages/omnimind-api/dist ./dist
COPY --from=builder /app/packages/omnimind-api/prisma ./prisma

# Overlay shared package (workspace dep bundled by pnpm deploy may lack dist)
COPY --from=builder /app/packages/shared/dist ./node_modules/@boardroom/shared/dist
COPY --from=builder /app/packages/shared/package.json ./node_modules/@boardroom/shared/package.json

# Copy generated Prisma client runtime
# (pnpm deploy --prod doesn't include the generated .prisma client)
COPY --from=builder /app/prisma-client-generated ./node_modules/.prisma

# Copy Prisma CLI from builder (devDep not in prod deploy, npx would pull latest 7.x which breaks schema)
COPY --from=builder /app/prisma-cli ./node_modules/prisma
COPY --from=builder /app/prisma-engines ./node_modules/@prisma/engines

COPY --from=builder /app/packages/omnimind-api/package.json ./package.json
COPY --from=builder /app/packages/omnimind-api/docker-entrypoint.sh .
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3333
CMD ["./docker-entrypoint.sh"]
