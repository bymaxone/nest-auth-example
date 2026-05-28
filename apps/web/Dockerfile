# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# apps/web/Dockerfile — multi-stage production image for the Next.js 16 web app.
#
# Build context: repository root (run `docker build -f apps/web/Dockerfile .`).
#
# Stages
#   base    — Node 24 Alpine + pnpm 10.
#   deps    — full workspace install for compilation.
#   build   — runs `next build` with `output: 'standalone'`.
#   runtime — minimal non-root image using the Next.js standalone server.
#
# Build-time ARGs
#   NEXT_PUBLIC_API_URL                 (required) e.g. https://example.com/api
#   NEXT_PUBLIC_WS_URL                  (required) e.g. wss://example.com
#   NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED    defaults to false
#   INTERNAL_API_URL                    build-time placeholder; override at runtime
#   AUTH_JWT_SECRET_FOR_PROXY           build-time placeholder; override at runtime
#
# Runtime env vars (provided via `-e` or docker-compose.prod.yml)
#   INTERNAL_API_URL          URL the Next.js server uses to proxy /api/* to NestJS
#   AUTH_JWT_SECRET_FOR_PROXY HS256 secret matching the API's JWT_SECRET
#
# Standalone output structure (with outputFileTracingRoot = monorepo root)
#   .next/standalone/
#     apps/web/server.js        ← entry point (server.js relative to app dir)
#     apps/web/...
#     node_modules/             ← traced monorepo node_modules
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: base ─────────────────────────────────────────────────────────
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.8.0 --activate

# ── Stage 2: deps ─────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /workspace

# Copy workspace manifests so pnpm can resolve the full dependency graph.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile --ignore-scripts

# ── Stage 3: build ────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /workspace

# Build-time ARGs for NEXT_PUBLIC_* vars — baked into the client JS bundle.
# These are legitimate compile-time constants: the public API URL is not secret.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED=false

# NEXT_PUBLIC_* vars must be set as ENV so Next.js inlines them at build time.
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED=$NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED
ENV NEXT_TELEMETRY_DISABLED=1

COPY . .

# Produce the standalone output.  INTERNAL_API_URL and AUTH_JWT_SECRET_FOR_PROXY
# are server-only secrets required by lib/env.ts's Zod schema at module load.
# They are provided inline so that they never persist as a Docker image layer
# (unlike ENV, inline RUN env vars are ephemeral and not visible in image history).
# Real values are injected exclusively at container run time via -e or compose.
# NEXT_STANDALONE=true activates `output: 'standalone'` in next.config.mjs,
# producing the self-contained server.js tree consumed by the runtime stage.
# INTERNAL_API_URL and AUTH_JWT_SECRET_FOR_PROXY are provided inline so that
# secrets never persist as an image layer (not visible in docker history).
RUN NEXT_STANDALONE=true \
    INTERNAL_API_URL=http://build-placeholder:4000 \
    AUTH_JWT_SECRET_FOR_PROXY=00000000000000000000000000000000 \
    pnpm --filter @nest-auth-example/web run build

# ── Stage 4: runtime ──────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app

# Non-root user matching the canonical UID used in Next.js official examples.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs

# Copy the standalone output.  With outputFileTracingRoot set to the monorepo
# root, Next.js places server.js at apps/web/server.js within the standalone
# tree and includes all traced node_modules relative to the monorepo root.
COPY --chown=nextjs:nodejs --from=build /workspace/apps/web/.next/standalone .

# Static assets are not included in standalone — copy separately.
COPY --chown=nextjs:nodejs --from=build /workspace/apps/web/.next/static ./apps/web/.next/static

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# PORT is read by Next.js standalone server.js to determine the listen port.
ENV PORT=3000

EXPOSE 3000

# Liveness probe — hits the root path since there is no dedicated /health
# route on the web app.  Replace with a dedicated health route if added later.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000 || exit 1

USER nextjs

# server.js is at apps/web/ within the standalone tree due to
# outputFileTracingRoot being set to the monorepo root.
WORKDIR /app/apps/web
CMD ["node", "server.js"]
