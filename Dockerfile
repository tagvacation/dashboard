# syntax=docker/dockerfile:1
# Container image for the dashboard — Debian (glibc) base so the native deps
# (@napi-rs/canvas, @imgly/background-removal-node/onnxruntime, sharp) work, and
# ffmpeg/ffprobe are present for the AI-ad compositor + merge.
FROM node:20-bookworm-slim

# ffmpeg bundles ffprobe; ca-certificates for outbound HTTPS (Vertex, GCS, Shopify).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (layer cached unless the lockfile changes).
COPY package.json package-lock.json ./
RUN npm ci

# App source. NOTE: src/assets/fonts (+ optional music) are read at runtime via
# process.cwd(), so the full source must be present — do not prune it.
COPY . .

# Build. Placeholder env vars only so module-load JSON.parse(GCS_SERVICE_ACCOUNT_JSON)
# and the DB client don't crash during `next build`. REAL secrets are injected at
# RUNTIME by the host (Railway/Render/Fly env vars), which override these.
RUN GCS_SERVICE_ACCOUNT_JSON='{}' DATABASE_URL='' npm run build

ENV NODE_ENV=production
# next start honours the PORT env var the host injects (defaults to 3000).
EXPOSE 3000
CMD ["npm", "run", "start"]
