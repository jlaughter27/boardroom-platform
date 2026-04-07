FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/omnimind-api/package.json packages/omnimind-api/

RUN npm install

COPY packages/shared/ packages/shared/
COPY packages/omnimind-api/ packages/omnimind-api/

RUN npx turbo run build --filter=@boardroom/omnimind-api
RUN cd packages/omnimind-api && npx prisma generate

FROM node:20-alpine AS runner

WORKDIR /app
COPY --from=builder /app/packages/omnimind-api/dist ./dist
COPY --from=builder /app/packages/omnimind-api/prisma ./prisma
COPY --from=builder /app/packages/omnimind-api/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./node_modules/@boardroom/shared/dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

ENV NODE_ENV=production
EXPOSE 3333
CMD ["node", "dist/index.js"]
