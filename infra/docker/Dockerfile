# syntax=docker/dockerfile:1

# MeCoil game server — multi-stage, multi-arch (amd64 / arm64) image.
# Serves the built Svelte client and the WebSocket game server from a single
# Node process on one port. TLS is expected to be terminated upstream
# (Caddy in docker-compose, or the AWS App Runner / reverse-proxy edge).

# ---- Stage 1: build the Svelte client (needs devDependencies + shared/) ----
FROM docker.io/library/node:22-alpine AS client-build
WORKDIR /app
COPY client/package.json client/package-lock.json ./client/
RUN npm ci --prefix client
COPY shared ./shared
COPY client ./client
RUN npm run build --prefix client

# ---- Stage 2: install production server dependencies only ----
FROM docker.io/library/node:22-alpine AS server-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Stage 3: minimal runtime ----
FROM docker.io/library/node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY --from=server-deps /app/node_modules ./node_modules
COPY --from=client-build /app/client/dist ./client/dist

EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://localhost:${PORT}/" >/dev/null 2>&1 || exit 1

CMD ["node", "server/index.js"]
