FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/boardroom-ai/package.json packages/boardroom-ai/

RUN npm install

COPY packages/shared/ packages/shared/
COPY packages/boardroom-ai/ packages/boardroom-ai/
COPY docs/prompts/ docs/prompts/

RUN npx turbo run build --filter=@boardroom/boardroom-ai

FROM node:20-alpine AS runner

WORKDIR /app
COPY --from=builder /app/packages/boardroom-ai/dist ./dist
COPY --from=builder /app/packages/boardroom-ai/client/dist ./client/dist
COPY --from=builder /app/packages/shared/dist ./node_modules/@boardroom/shared/dist
COPY --from=builder /app/packages/boardroom-ai/node_modules ./node_modules
COPY --from=builder /app/docs/prompts/ ./docs/prompts/

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/server/index.js"]
