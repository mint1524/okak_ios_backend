FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
# tsc skips non-TS files — copy SQL migrations into dist manually
RUN cp -r src/db/migrations dist/db/migrations

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=builder /app/dist ./dist
EXPOSE 3000 3001
CMD ["sh", "-c", "node --enable-source-maps dist/db/migrate.js && node --enable-source-maps dist/db/seed.js && node --enable-source-maps dist/admin/server.js & node --enable-source-maps dist/server.js"]
