# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# apps/api/Dockerfile — multi-stage production image for the NestJS API.
#
# Build context: repository root (run `docker build -f apps/api/Dockerfile .`).
#
# Stages
#   base    — Node 24 Alpine + pnpm 10.
#   deps    — full workspace install (dev + prod deps) for compilation.
#   build   — compiles TypeScript and generates the Prisma client.
#   deploy  — produces a prod-only dependency tree via `pnpm deploy`.
#   runtime — minimal, non-root image used in production.
#
# Notes on Alpine compatibility
#   Prisma 7 uses `@prisma/adapter-pg` (driver-adapter pattern), which routes
#   all queries through the `pg` Node.js driver. No native query-engine binary
#   is required, so node:24-alpine is safe (no glibc dependency).
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: base ─────────────────────────────────────────────────────────
FROM node:24-alpine AS base
# corepack ships with Node 24; activate the exact pnpm version pinned in
# package.json#packageManager to guarantee reproducible installs.
RUN corepack enable && corepack prepare pnpm@10.8.0 --activate

# ── Stage 2: deps ─────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /workspace

# Copy workspace manifests only — pnpm needs all package.json files to
# resolve workspace dependencies before any source is present.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install all deps (dev + prod) with the lockfile frozen.
# --ignore-scripts prevents postinstall from running prisma generate here;
# we run it explicitly in the build stage with the full source present.
RUN pnpm install --frozen-lockfile --ignore-scripts

# ── Stage 3: build ────────────────────────────────────────────────────────
FROM deps AS build

# Copy full monorepo source. .dockerignore removes node_modules, dist,
# .env files, and other artefacts so only source files reach this layer.
COPY . .

# Generate the Prisma client (schema-specific types + adapter-pg wiring).
# prisma.config.ts calls env('DATABASE_URL') even though prisma generate never
# connects to the database when using driver adapters. A credential-free
# placeholder satisfies the config loader without triggering secret scanners.
RUN DATABASE_URL=postgresql://localhost/prisma \
    pnpm --filter @nest-auth-example/api run prisma:generate

# Compile TypeScript to dist/.
RUN pnpm --filter @nest-auth-example/api run build

# ── Stage 4: deploy ───────────────────────────────────────────────────────
FROM build AS deploy

# Produce a self-contained production directory at /prod/api using pnpm's
# deploy command.  pnpm deploy:
#   • Installs only `dependencies` (no devDependencies) with a flat
#     npm-style node_modules — smaller than copying the pnpm virtual store.
#   • Copies non-gitignored source files (including prisma/schema.prisma).
#   • Does NOT copy dist/ (gitignored) — we copy it manually below.
RUN pnpm --filter @nest-auth-example/api deploy --prod /prod/api

# Copy compiled output.  dist/ is gitignored so pnpm deploy excludes it.
RUN cp -r /workspace/apps/api/dist /prod/api/dist

# Re-generate the Prisma client inside the deployed node_modules.
# pnpm deploy creates a fresh flat node_modules without running postinstall
# scripts, so the schema-specific @prisma/client code and .prisma/client
# JS files must be generated here.  The workspace's prisma CLI (a devDep,
# unavailable in the prod tree) is used with the schema from the deploy
# output; Prisma resolves the output path relative to the schema location.
RUN DATABASE_URL=postgresql://localhost/prisma \
    /workspace/apps/api/node_modules/.bin/prisma generate \
      --schema /prod/api/prisma/schema.prisma

# ── Stage 5: runtime ──────────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app

# Non-root user required by security policy — never run as root in production.
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001 -G nodejs

# Copy only the artefacts needed at runtime.
COPY --chown=nestjs:nodejs --from=deploy /prod/api/dist         ./dist
COPY --chown=nestjs:nodejs --from=deploy /prod/api/prisma       ./prisma
COPY --chown=nestjs:nodejs --from=deploy /prod/api/node_modules ./node_modules
COPY --chown=nestjs:nodejs --from=deploy /prod/api/package.json ./package.json

ENV NODE_ENV=production

# API port defaults to 4000 (env.schema.ts default); override with -e API_PORT.
EXPOSE 4000

# Liveness probe against the /api/health aggregate readiness endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

USER nestjs

CMD ["node", "dist/main.js"]
