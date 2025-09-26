# syntax=docker/dockerfile:1

FROM node:20-slim AS builder
WORKDIR /app

COPY package*.json ./
COPY tsconfig*.json ./
COPY vitest.config.ts ./
COPY .eslintrc.cjs ./
RUN npm install

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-slim AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/.env.example ./

EXPOSE 3000

CMD ["node", "dist/server.js"]
