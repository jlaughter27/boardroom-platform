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

RUN pnpm turbo run build --filter=@boardroom/boardroom-ai

FROM node:20-alpine AS runner

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app
COPY --from=builder /app/packages/boardroom-ai/dist ./dist
COPY --from=builder /app/packages/boardroom-ai/client/dist ./client/dist
COPY --from=builder /app/packages/shared/dist ./node_modules/@boardroom/shared/dist
COPY --from=builder /app/packages/boardroom-ai/node_modules ./node_modules
COPY --from=builder /app/docs/prompts/ ./docs/prompts/

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/server/index.js"]
