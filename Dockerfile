# syntax=docker/dockerfile:1

# ---------- Stage 1: build the Go backend ----------
# Runs on the build machine's platform and cross-compiles for the target
# (multi-arch images build arm64 without emulating the Go compiler).
# CGO_ENABLED=0 produces a fully static binary so it runs on any base image.
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS backend-build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/nexote-backend .

# ---------- Stage 2: build the Next.js frontend ----------
FROM node:22-alpine AS frontend-build
WORKDIR /app
# pnpm is pinned in package.json (plus a lockfile in frontend/). Installing it
# explicitly via npm is more predictable than corepack across base images.
RUN npm install -g pnpm@11.17.0
COPY frontend/package.json frontend/pnpm-lock.yaml ./
# Allow build scripts (sharp/esbuild) — the lockfile predates pnpm's build
# approval mechanism, so approve them non-interactively here.
RUN pnpm install --frozen-lockfile --config.dangerouslyAllowAllBuilds=true
COPY frontend/ ./
# NEXOTE_BACKEND_URL is read by the rewrites in next.config.mjs; the standalone
# server re-evaluates it at runtime and we set the same value in the runtime
# image, so both processes agree on http://127.0.0.1:8080.
ENV NEXOTE_BACKEND_URL=http://127.0.0.1:8080
# Version and commit for Settings › About. The build context has no .git, so
# they come in as build args (docker-compose.yml passes them through);
# without them next.config.mjs falls back to package.json.
ARG NEXOTE_VERSION=""
ARG NEXOTE_COMMIT=""
RUN pnpm build

# ---------- Stage 3: minimal runtime image with both services ----------
FROM node:22-alpine
# tini forwards signals properly so `docker stop` shuts both processes down.
RUN apk add --no-cache tini
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/2TAP2B/nexote" \
      org.opencontainers.image.description="Self-hosted, mobile-first markdown editor" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

ENV NODE_ENV=production
ENV NEXOTE_HOME=/data/nexote
ENV NEXOTE_PORT=8080
ENV NEXOTE_BACKEND_URL=http://127.0.0.1:8080
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Go backend binary.
COPY --from=backend-build /out/nexote-backend /usr/local/bin/nexote-backend

# Next standalone server (self-contained node_modules + server.js).
COPY --from=frontend-build /app/.next/standalone ./
# Static assets + server chunks are NOT traced into standalone; copy them over.
COPY --from=frontend-build /app/.next/static ./.next/static
# Public assets (PWA manifest, icons, service worker) — also not traced.
COPY --from=frontend-build /app/public ./public

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Persistent note data (see note about permissions in the docs / compose file).
VOLUME ["/data"]

EXPOSE 3000 8080
ENTRYPOINT ["tini", "--", "/usr/local/bin/docker-entrypoint.sh"]