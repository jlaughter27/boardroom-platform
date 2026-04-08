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

FROM node:20-alpine AS runner

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app
COPY --from=builder /app/packages/omnimind-api/dist ./dist
COPY --from=builder /app/packages/omnimind-api/prisma ./prisma
COPY --from=builder /app/packages/omnimind-api/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./node_modules/@boardroom/shared/dist
COPY --from=builder /app/packages/shared/package.json ./node_modules/@boardroom/shared/package.json
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

COPY --from=builder /app/packages/omnimind-api/package.json ./package.json
COPY --from=builder /app/packages/omnimind-api/docker-entrypoint.sh .
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3333
CMD ["./docker-entrypoint.sh"]
