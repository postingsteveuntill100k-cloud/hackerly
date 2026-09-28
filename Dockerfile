# Hackerly — self-hostable image.
#
# One process, one SQLite file, no outbound network. The build installs
# dependencies; the image seeds on first boot so `docker compose up` produces
# a working portal with nothing else to do.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    DATABASE_PATH=/data/hackerly.db \
    SEED_ON_BOOT=true \
    SEED_DEMO=true

# wget is used by the healthcheck; nothing else is added to the base image.
RUN apk add --no-cache tini

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY fixtures.json run.py .dogfood.toml ./

# The database lives on a volume so it survives a rebuild.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=4s --start-period=8s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:${PORT}/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
