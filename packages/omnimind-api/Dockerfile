FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app
COPY package.json turbo.json tsconfig.base.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/omnimind-api/package.json packages/omnimind-api/

RUN pnpm install --frozen-lockfile

COPY packages/shared/ packages/shared/
COPY packages/omnimind-api/ packages/omnimind-api/

RUN pnpm turbo run build --filter=@boardroom/omnimind-api
RUN cd packages/omnimind-api && pnpm prisma generate

FROM node:20-alpine AS runner

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app
COPY --from=builder /app/packages/omnimind-api/dist ./dist
COPY --from=builder /app/packages/omnimind-api/prisma ./prisma
COPY --from=builder /app/packages/omnimind-api/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./node_modules/@boardroom/shared/dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

COPY --from=builder /app/packages/omnimind-api/package.json ./package.json
COPY --from=builder /app/packages/omnimind-api/docker-entrypoint.sh .
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3333
CMD ["./docker-entrypoint.sh"]
