# nest-auth-example — Development Plan

> **Scope.** This document is the authoritative, phase-by-phase build plan for the `nest-auth-example` reference application described in `docs/OVERVIEW.md`. Each phase is written as a self-contained deliverable so it can be lifted directly into an issue tracker (one task per checklist item).
>
> **Source of truth for what must be demonstrated:** the **Feature Coverage Matrix** in `docs/OVERVIEW.md` §6 (rows #1–#32). The phases below are organized so that every matrix row has a single, unambiguous home.
>
> **Targeted library version:** `@bymax-one/nest-auth@^1.0.0`.
>
> **Document version:** 1.0 — initial plan.
> **Status:** Ready to execute. Phase 0 must complete before any other phase starts.

---

## Table of Contents

- [Progress Summary](#progress-summary)
- [0. Guiding Principles](#0-guiding-principles)
- [1. Phase Map & Dependencies](#1-phase-map--dependencies)
- [2. Global Conventions](#2-global-conventions)
- [Phase 0 — Repository Foundation & Tooling](#phase-0--repository-foundation--tooling)
- [Phase 1 — Local Infrastructure (Docker Compose)](#phase-1--local-infrastructure-docker-compose)
- [Phase 2 — Library Linking & Workspace Bootstrap](#phase-2--library-linking--workspace-bootstrap)
- [Phase 3 — `apps/api` Skeleton (NestJS 11)](#phase-3--appsapi-skeleton-nestjs-11)
- [Phase 4 — Prisma Schema, Migrations & Seed](#phase-4--prisma-schema-migrations--seed)
- [Phase 5 — Infrastructure Modules: Prisma, Redis, Health, Config](#phase-5--infrastructure-modules-prisma-redis-health-config)
- [Phase 6 — Library Wiring: `auth.config.ts`, Repositories, Email, Hooks](#phase-6--library-wiring-authconfigts-repositories-email-hooks)
- [Phase 7 — `BymaxAuthModule.registerAsync` + Guards/Decorators Demo Domain](#phase-7--bymaxauthmoduleregisterasync--guardsdecorators-demo-domain)
- [Phase 8 — OAuth (Google) & Invitations Backends](#phase-8--oauth-google--invitations-backends)
- [Phase 9 — Platform Admin Context (Backend)](#phase-9--platform-admin-context-backend)
- [Phase 10 — WebSocket Auth (Backend)](#phase-10--websocket-auth-backend)
- [Phase 11 — `apps/web` Skeleton (Next.js 16 + Tailwind + shadcn/ui)](#phase-11--appsweb-skeleton-nextjs-16--tailwind--shadcnui)
- [Phase 12 — Frontend Auth Wiring (Client, Provider, Proxy, Refresh, Logout)](#phase-12--frontend-auth-wiring-client-provider-proxy-refresh-logout)
- [Phase 13 — Public Auth Pages (`app/(auth)`)](#phase-13--public-auth-pages-appauth)
- [Phase 14 — Dashboard: Account, Security, Sessions, Team, Invitations](#phase-14--dashboard-account-security-sessions-team-invitations)
- [Phase 15 — Platform Admin Area (Frontend)](#phase-15--platform-admin-area-frontend)
- [Phase 16 — WebSocket Consumer + Notification Toast](#phase-16--websocket-consumer--notification-toast)
- [Phase 17 — Testing (Unit, E2E, Playwright)](#phase-17--testing-unit-e2e-playwright)
- [Phase 18 — Documentation (docs/*)](#phase-18--documentation-docs)
- [Phase 19 — CI/CD, Release Automation, Production Build](#phase-19--cicd-release-automation-production-build)
- [Phase 20 — Coverage Audit & Hardening](#phase-20--coverage-audit--hardening)
- [Appendix A — Environment Variable Registry](#appendix-a--environment-variable-registry)
- [Appendix B — Library Export → Example File Map](#appendix-b--library-export--example-file-map)

---

## Progress Summary

> Task execution dashboard. Each phase has a dedicated file under [`docs/tasks/`](./tasks/) containing small, AI-agent-executable tasks. When a task agent marks a task done, it MUST update both the per-phase file **and** this table.
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🟢 Done · ⚪ Blocked · 🔵 In Review
>
> **Overall progress:** 🔴 0 / 126 tasks done (0%)

| # | Phase | Tasks file | Done / Total | % | Status |
| -- | --- | --- | --- | --- | --- |
| 0 | Repository Foundation & Tooling | [phase-00](./tasks/phase-00-repo-foundation.md) | 0 / 10 | 0% | 🔴 |
| 1 | Local Infrastructure (Docker) | [phase-01](./tasks/phase-01-docker-infra.md) | 0 / 5 | 0% | 🔴 |
| 2 | Library Linking & Workspace Bootstrap | [phase-02](./tasks/phase-02-library-linking.md) | 0 / 4 | 0% | 🔴 |
| 3 | `apps/api` Skeleton (NestJS 11) | [phase-03](./tasks/phase-03-api-skeleton.md) | 0 / 6 | 0% | 🔴 |
| 4 | Prisma Schema, Migrations & Seed | [phase-04](./tasks/phase-04-prisma-schema.md) | 0 / 6 | 0% | 🔴 |
| 5 | Infrastructure Modules (Prisma, Redis, Health, Config) | [phase-05](./tasks/phase-05-infra-modules.md) | 0 / 5 | 0% | 🔴 |
| 6 | Library Wiring (auth.config, repos, email, hooks) | [phase-06](./tasks/phase-06-library-wiring.md) | 0 / 6 | 0% | 🔴 |
| 7 | `BymaxAuthModule.registerAsync` + Demo Domain | [phase-07](./tasks/phase-07-auth-module-demo-domain.md) | 0 / 8 | 0% | 🔴 |
| 8 | OAuth (Google) & Invitations Backends | [phase-08](./tasks/phase-08-oauth-invitations.md) | 0 / 5 | 0% | 🔴 |
| 9 | Platform Admin Context (Backend) | [phase-09](./tasks/phase-09-platform-backend.md) | 0 / 4 | 0% | 🔴 |
| 10 | WebSocket Auth (Backend) | [phase-10](./tasks/phase-10-websocket-backend.md) | 0 / 3 | 0% | 🔴 |
| 11 | `apps/web` Skeleton (Next.js 16 + Tailwind + shadcn/ui) | [phase-11](./tasks/phase-11-web-skeleton.md) | 0 / 6 | 0% | 🔴 |
| 12 | Frontend Auth Wiring (Client, Provider, Proxy, Refresh, Logout) | [phase-12](./tasks/phase-12-frontend-auth-wiring.md) | 0 / 6 | 0% | 🔴 |
| 13 | Public Auth Pages (`app/(auth)`) | [phase-13](./tasks/phase-13-public-auth-pages.md) | 0 / 8 | 0% | 🔴 |
| 14 | Dashboard (Account, Security, Sessions, Team, Invitations) | [phase-14](./tasks/phase-14-dashboard.md) | 0 / 7 | 0% | 🔴 |
| 15 | Platform Admin Area (Frontend) | [phase-15](./tasks/phase-15-platform-frontend.md) | 0 / 4 | 0% | 🔴 |
| 16 | WebSocket Consumer + Notification Toast | [phase-16](./tasks/phase-16-websocket-frontend.md) | 0 / 3 | 0% | 🔴 |
| 17 | Testing (Unit, E2E, Playwright) | [phase-17](./tasks/phase-17-testing.md) | 0 / 10 | 0% | 🔴 |
| 18 | Documentation (docs/*) | [phase-18](./tasks/phase-18-documentation.md) | 0 / 11 | 0% | 🔴 |
| 19 | CI/CD, Release Automation, Production Build | [phase-19](./tasks/phase-19-cicd.md) | 0 / 5 | 0% | 🔴 |
| 20 | Coverage Audit & Hardening | [phase-20](./tasks/phase-20-audit-hardening.md) | 0 / 4 | 0% | 🔴 |

### How to update this dashboard

When a task's status changes, the executing agent must:

1. Edit the task block inside the corresponding `docs/tasks/phase-NN-*.md` file — change `**Status:** 🔴 Not Started` to the new status emoji + label.
2. Update the phase file's header counter (`Progress: N / M done`) and the index table inside that file.
3. Update the matching row in the table above (`Done / Total`, `%`, and `Status` column).
4. Recompute the **Overall progress** line above the table (sum of Done / 126).
5. On completion, append a one-line entry to the `## Completion log` section at the bottom of the phase file.

---

## 0. Guiding Principles

1. **Copy-paste friendly.** Every file in `apps/api/src/auth/` and `apps/web/lib/` must be something a consumer can lift into their own project with only env-var changes.
2. **No shortcuts.** Features demonstrated must work end-to-end — UI form → HTTP call → library service → database/Redis → email capture → back to UI.
3. **Mirror the library's public surface exactly.** Wire every exported symbol from `@bymax-one/nest-auth` at least once (enforced by Phase 20 audit).
4. **One responsibility per file.** Repository implementations never call services; services never call Prisma directly; controllers never touch Redis.
5. **Fail fast on configuration.** `auth.config.ts` validates every env var at startup using `zod`; missing or malformed values abort boot.
6. **Secure defaults.** `secureCookies` derived from `NODE_ENV`, `JWT_SECRET` rejected if entropy < 3.5 bits/char, MFA encryption key validated as 32-byte base64 at startup.
7. **Tenant-safe by construction.** Every domain query (`projects`, `invitations`, `users`) is scoped by `tenantId` extracted via `tenantIdResolver`; the header `X-Tenant-Id` is the single entry point.
8. **Deterministic local dev.** `pnpm dev` starts `docker compose up -d` for infra and runs both apps with hot-reload. No "works on my machine."
9. **Each phase lands on green CI.** No phase merges while tests or typecheck are red.

---

## 1. Phase Map & Dependencies

```
Phase 0 (Repo) ──┐
                 ├─▶ Phase 2 (Link lib) ──▶ Phase 3 (api skeleton) ──▶ Phase 4 (Prisma) ──┐
Phase 1 (Docker) ┘                                                                         │
                                                                                           ▼
                                                                          Phase 5 (infra modules)
                                                                                           │
                                                                                           ▼
                                                             Phase 6 (wiring: config/repo/email/hooks)
                                                                                           │
                                                                                           ▼
                                                             Phase 7 (BymaxAuthModule + demo domain)
                                                                                           │
                                                                            ┌──────────────┼──────────────┐
                                                                            ▼              ▼              ▼
                                                                   Phase 8 (OAuth)  Phase 9 (Platform)  Phase 10 (WS)
                                                                            │              │              │
                                                                            └──────────────┼──────────────┘
                                                                                           ▼
                                                                     Phase 11 (web skeleton)
                                                                                           │
                                                                                           ▼
                                                                     Phase 12 (web auth wiring)
                                                                                           │
                                                                            ┌──────────────┼──────────────┐
                                                                            ▼              ▼              ▼
                                                              Phase 13 (public)  Phase 14 (dashboard)  Phase 15 (platform UI)
                                                                                           │
                                                                                           ▼
                                                                            Phase 16 (WS client)
                                                                                           │
                                                                                           ▼
                                                                     Phase 17 (tests) ─────┐
                                                                                           ▼
                                                                          Phase 18 (docs) ─┤
                                                                                           ▼
                                                                          Phase 19 (CI/CD) ┤
                                                                                           ▼
                                                                          Phase 20 (audit) ┘
```

**Parallelization notes.** Phases 8/9/10 can proceed in parallel once Phase 7 lands. Phases 13/14/15 can proceed in parallel once Phase 12 lands. Phases 17/18 are independent of each other.

---

## 2. Global Conventions

| Concern | Convention |
| --- | --- |
| Package manager | `pnpm@^10.8` with workspace mode |
| Node version | `>=24` (pinned via `.nvmrc` and `engines.node`) |
| TypeScript | `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true` |
| Module system | ESM everywhere (`"type": "module"`); both apps are ESM-only to match the library |
| Lint / format | ESLint v9 flat config, Prettier 3, Husky + lint-staged |
| Commit style | Conventional Commits, enforced via `commitlint` |
| Env loading | `dotenv-safe` against `.env.example` (root) + per-app `.env` |
| Logging | `nestjs-pino` for `apps/api`, `pino` for edge/API routes on `apps/web` |
| HTTP client | `@bymax-one/nest-auth/client` only — no manual `fetch` calls against auth routes |
| UI kit | shadcn/ui + Tailwind CSS v4; components generated into `apps/web/components/ui/` |
| Form / validation | `react-hook-form` + `zod` (shared schemas in `apps/web/lib/schemas/`) |
| Icons | `lucide-react` |
| Date | `date-fns` (no moment, no dayjs) |
| PR requirement | Every PR updates the matching row in `docs/OVERVIEW.md` §6 (status column) |

---

## Phase 0 — Repository Foundation & Tooling

**Goal.** Produce a buildable monorepo with zero runtime code but complete tooling. Everything that follows assumes these conventions are in place.

**Prerequisites.** Empty or minimally populated `nest-auth-example/` directory with `docs/OVERVIEW.md` already present.

**Deliverables.**

- [ ] `package.json` (workspace root) with:
  - `name: "nest-auth-example"`, `private: true`, `type: "module"`.
  - `engines.node: ">=24"`, `engines.pnpm: ">=10.8"`.
  - Scripts: `dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e`, `format`, `prepare`.
- [ ] `pnpm-workspace.yaml` registering `apps/*` and (optional) `packages/*`.
- [ ] `.nvmrc` = `24`.
- [ ] `.gitignore` covering `node_modules`, `dist`, `.next`, `coverage`, `.env`, `*.log`, `pnpm-lock.yaml` **not** ignored.
- [ ] `.editorconfig` with LF line endings, 2-space indent, UTF-8.
- [ ] `tsconfig.base.json` at root (strict, ESM, bundler moduleResolution).
- [ ] `eslint.config.mjs` at root — flat config, extends `@typescript-eslint/recommended-type-checked`, imports the library's ESLint preset when available.
- [ ] `.prettierrc.mjs` + `.prettierignore`.
- [ ] `commitlint.config.mjs` + `.husky/commit-msg` + `.husky/pre-commit` (lint-staged).
- [ ] `lint-staged.config.mjs`.
- [ ] `.env.example` — empty scaffold, will be populated incrementally. Must list every variable from Appendix A before Phase 20 closes.
- [ ] `README.md` — one-paragraph intro + link to `docs/OVERVIEW.md` and this file.
- [ ] `LICENSE` — MIT.
- [ ] `CHANGELOG.md` — initial `## [Unreleased]` section.
- [ ] `CONTRIBUTING.md` — references Section 16 of `OVERVIEW.md`.

**Definition of done.** `pnpm install` + `pnpm typecheck` + `pnpm lint` pass on an empty workspace.

---

## Phase 1 — Local Infrastructure (Docker Compose)

**Goal.** Single-command local stack (Postgres 18, Redis 7, Mailpit) ready for the apps to connect to.

**Prerequisites.** Phase 0.

**Deliverables.**

- [ ] `docker-compose.yml` at repo root:
  - `postgres` — image `postgres:18-alpine`, port `5432:5432`, volume `pg-data:/var/lib/postgresql/data`, env from `.env`, healthcheck via `pg_isready`.
  - `redis` — image `redis:7-alpine`, port `6379:6379`, command uses `/usr/local/etc/redis/redis.conf`, healthcheck via `redis-cli ping`.
  - `mailpit` — image `axllent/mailpit:latest`, ports `1025:1025` and `8025:8025`, no persistence in dev.
- [ ] `docker-compose.override.yml` — dev-only tweaks (e.g., `restart: unless-stopped`, bind-mounted configs). Already part of the git repo but documented as dev-only in README.
- [ ] `docker/postgres/init.sql` — `CREATE DATABASE example_app;` (plus `example_app_test` for integration tests).
- [ ] `docker/redis/redis.conf` — `appendonly yes`, `maxmemory-policy allkeys-lru`, `save ""` for dev.
- [ ] `docker-compose.test.yml` — alternate file used by CI e2e: same services, different host ports (`55432`, `56379`, `58025`) so local dev can run in parallel.
- [ ] (Optional, flagged) `docker-compose.full.yml` — `--profile full` adds containerized `api` and `web` services for parity tests with production images.
- [ ] Root script `pnpm infra:up` → `docker compose up -d`, `pnpm infra:down` → `docker compose down -v` (with confirmation).

**Definition of done.** `pnpm infra:up` brings services up green, `pnpm infra:logs` streams logs, `curl http://localhost:8025/` returns the Mailpit UI, `psql postgres://postgres:postgres@localhost:5432/example_app -c 'select 1'` succeeds.

---

## Phase 2 — Library Linking & Workspace Bootstrap

**Goal.** The workspace can import `@bymax-one/nest-auth` and its subpaths (`/shared`, `/client`, `/react`, `/nextjs`) with full types.

**Prerequisites.** Phase 0. Library checkout exists at `../nest-auth` and `pnpm build` inside it succeeds.

**Deliverables.**

- [ ] `scripts/link-library.sh`:
  1. `cd ../nest-auth && pnpm install && pnpm build && pnpm link --global`.
  2. `cd - && pnpm link --global @bymax-one/nest-auth`.
  3. Idempotent (no-op if already linked).
  4. Emits a diagnostic: prints resolved path of the linked package (using `node -p`).
- [ ] `scripts/unlink-library.sh` — reverse. Used when switching back to the published package.
- [ ] Root `package.json` adds dependency placeholder: `"@bymax-one/nest-auth": "link:../nest-auth"` *only* while the package is unpublished. Document the swap in `docs/GETTING_STARTED.md` (Phase 18).
- [ ] TypeScript path alias *not* used — the pnpm link resolves naturally via `node_modules`. Do not leak monorepo paths into `tsconfig`.
- [ ] Probe file `apps/api/src/auth/_probe.ts` (temporary — deleted after Phase 3) that imports one symbol from each subpath to confirm typings:
  ```ts
  import type { BymaxAuthModuleOptions } from '@bymax-one/nest-auth';
  import { AUTH_ERROR_CODES } from '@bymax-one/nest-auth/shared';
  ```
- [ ] Document expected on-disk layout in `docs/GETTING_STARTED.md` (Phase 18): `~/projects/nest-auth/` + `~/projects/nest-auth-example/`.

**Definition of done.** `pnpm typecheck` passes with the probe file present.

---

## Phase 3 — `apps/api` Skeleton (NestJS 11)

**Goal.** Runnable NestJS 11 Express server on port `4000` with zero auth logic. Only `/health` responds.

**Prerequisites.** Phase 2.

**Deliverables.**

- [ ] `apps/api/package.json`:
  - `"type": "module"`.
  - Dependencies: `@nestjs/common@^11`, `@nestjs/core@^11`, `@nestjs/jwt@^11`, `@nestjs/throttler@^6`, `@nestjs/websockets@^11`, `@nestjs/platform-express@^11`, `express@^5`, `reflect-metadata@^0.2`, `rxjs@^7`, `class-validator`, `class-transformer`, `ioredis@^5`, `@bymax-one/nest-auth` (linked), `@prisma/client@^6`, `pino`, `nestjs-pino`, `zod`, `dotenv-safe`.
  - Dev: `@nestjs/cli@^11`, `@nestjs/testing`, `@types/express@^5`, `jest`, `supertest`, `ts-jest`, `ts-node`, `tsx`, `typescript`, `prisma@^6`.
  - Scripts: `dev` (nest start --watch), `build`, `start`, `test`, `test:e2e`, `typecheck`, `lint`, `prisma:*`.
- [ ] `apps/api/tsconfig.json` (extends root base, `rootDir: src`, `outDir: dist`).
- [ ] `apps/api/tsconfig.build.json`.
- [ ] `apps/api/nest-cli.json`.
- [ ] `apps/api/src/main.ts`:
  - Bootstrap NestFactory with Express adapter.
  - Global `ValidationPipe` (whitelist, transform, forbidNonWhitelisted).
  - `cookie-parser` middleware.
  - Structured logging via `nestjs-pino`.
  - `setGlobalPrefix('api')` — **all domain routes** live under `/api/*`; the library's `routePrefix: 'auth'` means auth routes become `/api/auth/*`.
  - Graceful shutdown hooks (`app.enableShutdownHooks()`).
- [ ] `apps/api/src/app.module.ts` — imports only `HealthModule` and `LoggerModule.forRoot({...})` at this phase.
- [ ] `apps/api/src/health/health.module.ts` + `health.controller.ts` — `GET /api/health` returns `{ status: 'ok', uptime, version }`.
- [ ] `.env` (gitignored) + contribution to root `.env.example` — at minimum `API_PORT`, `NODE_ENV`, `LOG_LEVEL`.
- [ ] Delete the Phase 2 probe file.

**Definition of done.** `pnpm --filter @nest-auth-example/api dev` serves `GET http://localhost:4000/api/health` with a 200 response.

---

## Phase 4 — Prisma Schema, Migrations & Seed

**Goal.** Full database schema that backs every library contract (`IUserRepository`, `IPlatformUserRepository`, invitations, audit log) plus example domain tables.

**Prerequisites.** Phases 1, 3.

**Deliverables.**

- [ ] `apps/api/prisma/schema.prisma`:
  - `datasource db { provider = "postgresql"; url = env("DATABASE_URL") }`.
  - `generator client { provider = "prisma-client-js"; previewFeatures = [] }`.
  - **Tables:**
    - `Tenant` — id (cuid), name, slug (unique), domain (unique, nullable), createdAt, updatedAt.
    - `User` — mirrors `AuthUser`:
      - id (cuid), tenantId (FK → Tenant), email, name, passwordHash (nullable), role (enum `Role { OWNER ADMIN MEMBER VIEWER }`), status (enum `UserStatus { ACTIVE PENDING SUSPENDED BANNED INACTIVE }`), emailVerified (bool), mfaEnabled (bool), mfaSecret (nullable), mfaRecoveryCodes (text[]), oauthProvider (nullable), oauthProviderId (nullable), lastLoginAt (nullable), createdAt, updatedAt.
      - Unique `(tenantId, email)`, unique `(oauthProvider, oauthProviderId)` where both non-null.
      - Index on `(tenantId)`.
    - `PlatformUser` — mirrors `AuthPlatformUser`: id, email (unique), name, passwordHash, role (enum `PlatformRole { SUPER_ADMIN SUPPORT }`), status, mfaEnabled, mfaSecret, mfaRecoveryCodes, platformId (nullable), lastLoginAt, createdAt, updatedAt.
    - `Invitation` — id, tenantId, email, role (Role), token (unique, sha256), invitedByUserId, expiresAt, acceptedAt (nullable), createdAt.
    - `AuditLog` — id, tenantId (nullable — platform events are tenantless), actorUserId (nullable), actorPlatformUserId (nullable), event (string), payload (jsonb), ip (nullable), userAgent (nullable), createdAt. Indexes on `(tenantId, createdAt desc)` and `(event, createdAt desc)`.
    - `Project` — toy domain: id, tenantId, name, ownerUserId, createdAt. Index on `(tenantId)`.
- [ ] `apps/api/prisma/migrations/` — initial migration generated via `prisma migrate dev -n init`.
- [ ] `apps/api/prisma/seed.ts`:
  - Creates two tenants (`acme` + `globex`).
  - Creates demo users per tenant: one per role (OWNER, ADMIN, MEMBER, VIEWER). Known passwords documented in `GETTING_STARTED.md` — **dev only**.
  - Creates one platform super-admin.
  - Marks all demo users `emailVerified: true`.
  - Idempotent (uses `upsert`).
- [ ] Script `pnpm --filter api prisma:seed` = `prisma db seed`.
- [ ] Document every field-library mapping in `docs/DATABASE.md` (Phase 18).

**Definition of done.** `pnpm --filter api prisma:migrate dev` + `pnpm --filter api prisma:seed` run clean on a fresh `docker compose up` and produce the expected rows.

---

## Phase 5 — Infrastructure Modules: Prisma, Redis, Health, Config

**Goal.** Reusable NestJS modules for cross-cutting infra, used by every feature module.

**Prerequisites.** Phase 4.

**Deliverables.**

- [ ] `apps/api/src/config/env.schema.ts` — zod schema for every env var (see Appendix A). Parsed and frozen at bootstrap; `ConfigService.get` always returns validated values.
- [ ] `apps/api/src/config/config.module.ts` — `ConfigModule.forRoot({ load: [envLoader], isGlobal: true, validate: zodValidate })`.
- [ ] `apps/api/src/prisma/prisma.module.ts` + `prisma.service.ts`:
  - `PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy`.
  - Connects on init, disconnects on shutdown.
  - Exported as a provider usable by any feature module.
- [ ] `apps/api/src/redis/redis.module.ts` + `redis.provider.ts`:
  - Exposes an `ioredis` instance under the injection token expected by the library: **`BYMAX_AUTH_REDIS_CLIENT`**.
  - Single connection, lazy connect, retry strategy, `maxRetriesPerRequest: null` (required for blocking commands if used elsewhere).
- [ ] `apps/api/src/health/health.controller.ts` upgraded:
  - `GET /api/health` aggregates: app uptime, Postgres `SELECT 1`, Redis `PING`, library version (from `package.json` of `@bymax-one/nest-auth`).
  - `GET /api/health/throttle-demo` — a throttled endpoint used by Feature #17 demo; applies `@Throttle` via `AUTH_THROTTLE_CONFIGS`.
- [ ] `apps/api/src/logger/logger.module.ts` — `nestjs-pino` wired; sanitizes headers via library `sanitizeHeaders`.

**Definition of done.** `pnpm --filter api dev` boots, `GET /api/health` returns all-green JSON.

---

## Phase 6 — Library Wiring: `auth.config.ts`, Repositories, Email, Hooks

**Goal.** Every interface the library requires is implemented once, in `apps/api/src/auth/`, and nowhere else.

**Prerequisites.** Phase 5.

**Deliverables.**

### 6.1 `auth.config.ts`

- [ ] `apps/api/src/auth/auth.config.ts`:
  - Exports `buildAuthOptions(config: ConfigService): BymaxAuthModuleOptions`.
  - Returns a fully-typed options object with:
    - `jwt`: secret from env (rejected if `< 32` chars or entropy `< 3.5` bits/char), `accessExpiresIn: '15m'`, `refreshExpiresInDays: 7`, `refreshGraceWindowSeconds: 30`.
    - `mfa`: `encryptionKey` from env, `issuer: 'nest-auth-example'`, `recoveryCodeCount: 8`.
    - `sessions`: `enabled: true`, `defaultMaxSessions: 5`, `evictionStrategy: 'fifo'`.
    - `bruteForce`: `maxAttempts: 5`, `windowSeconds: 900`.
    - `passwordReset`: `method: env('PASSWORD_RESET_METHOD') ?? 'token'`, `tokenTtlSeconds: 600`, `otpTtlSeconds: 600`, `otpLength: 6`.
    - `emailVerification`: `required: true`, `otpTtlSeconds: 600`.
    - `platform`: `enabled: true`.
    - `invitations`: `enabled: true`, `tokenTtlSeconds: 172_800`.
    - `oauth`: `google: { ... }` only when both `OAUTH_GOOGLE_CLIENT_ID` and `OAUTH_GOOGLE_CLIENT_SECRET` are set (otherwise omitted).
    - `roles`:
      - `hierarchy: { OWNER: ['ADMIN', 'MEMBER', 'VIEWER'], ADMIN: ['MEMBER', 'VIEWER'], MEMBER: ['VIEWER'], VIEWER: [] }`.
      - `platformHierarchy: { SUPER_ADMIN: ['SUPPORT'], SUPPORT: [] }`.
    - `blockedStatuses: ['BANNED', 'INACTIVE', 'SUSPENDED']`.
    - `redisNamespace: 'nest-auth-example'`.
    - `routePrefix: 'auth'` (final URL becomes `/api/auth/*` because of the global `api` prefix).
    - `cookies`: names defaulted; `resolveDomains` implemented (returns `['.example.com']` in production if `PUBLIC_DOMAIN` env is set, else undefined).
    - `tenantIdResolver`: extracts `x-tenant-id` header. Throws `AuthException` with `FORBIDDEN` if absent on routes that require it (platform routes bypass via custom resolver logic).
    - `secureCookies: process.env.NODE_ENV === 'production'`.

### 6.2 `PrismaUserRepository`

- [ ] `apps/api/src/auth/prisma-user.repository.ts` — implements `IUserRepository`:
  - Every method maps Prisma rows to the exact `AuthUser` shape.
  - `create`, `createWithOAuth`, `updateMfa` preserve values the library passes as-is (never re-hash `passwordHash`, never re-encrypt `mfaSecret`, never re-hash `mfaRecoveryCodes`).
  - `findByEmail(email, tenantId)` uses the compound unique index.
  - `findByOAuthId(provider, providerId, tenantId)` filters by the optional unique index.
  - Unit tests at `prisma-user.repository.spec.ts` (Phase 17).

### 6.3 `PrismaPlatformUserRepository`

- [ ] `apps/api/src/auth/prisma-platform-user.repository.ts` — implements `IPlatformUserRepository` analogously against `PlatformUser`.

### 6.4 Email Providers

- [ ] `apps/api/src/auth/mailpit-email.provider.ts` — implements `IEmailProvider`:
  - Uses `nodemailer` with SMTP pointing at Mailpit (`localhost:1025`, no auth, no TLS).
  - Renders simple HTML templates in `apps/api/src/auth/email-templates/*.html` (one per interface method).
  - Logs every email (subject + recipient, **never body**).
- [ ] `apps/api/src/auth/resend-email.provider.ts` — implements `IEmailProvider` using the Resend SDK:
  - Configured only when `EMAIL_PROVIDER=resend`.
  - Reuses the same templates.
  - Production reference — documented as optional in README.
- [ ] Provider selection logic in `AuthModule` (Phase 7) — picks one based on `EMAIL_PROVIDER` env var.

### 6.5 Auth Hooks

- [ ] `apps/api/src/auth/app-auth.hooks.ts` — implements `IAuthHooks`:
  - Each hook inserts one row into `AuditLog` with a distinct `event` slug (`user.registered`, `user.login.succeeded`, `session.evicted`, `mfa.enabled`, etc.).
  - Payload omits secrets (never stores tokens, codes, or raw passwords).
  - Non-blocking: if the insert fails, the hook logs and swallows — auth must not fail because of audit.
  - `beforeRegister` always returns `{ allow: true }` in this example but is wired and covered by a unit test.

### 6.6 Injection

- [ ] `apps/api/src/auth/auth.module.ts` (new file, stub in this phase):
  - Exposes `PrismaUserRepository`, `PrismaPlatformUserRepository`, `MailpitEmailProvider`/`ResendEmailProvider`, `AppAuthHooks` as providers.
  - Actual `BymaxAuthModule.registerAsync(...)` happens in Phase 7.

**Definition of done.** `pnpm --filter api typecheck` is green; unit tests for the four implementations pass (Phase 17 will expand them, but the files exist now).

---

## Phase 7 — `BymaxAuthModule.registerAsync` + Guards/Decorators Demo Domain

**Goal.** Auth fully live on the backend. Covers Matrix rows #1 (register), #2 (login), #3 (JWT rotation), #4 (revocation), #5 (email verification), #6/#7 (password reset token + OTP), #13/#14 (sessions), #15 (new-session email), #16 (brute force), #17 (throttle), #18/#19 (RBAC + decorators), #20 (multi-tenant), #23 (status enforcement), #29 (error codes), #30 (hooks), #31 (email provider), #32 (user repo).

**Prerequisites.** Phase 6.

**Deliverables.**

- [ ] `apps/api/src/auth/auth.module.ts`:
  - Imports: `ConfigModule`, `PrismaModule`, `RedisModule`, and the library:
    ```ts
    BymaxAuthModule.registerAsync({
      imports: [ConfigModule, PrismaModule, RedisModule],
      useFactory: (config: ConfigService) => buildAuthOptions(config),
      inject: [ConfigService],
      controllers: {
        mfa: true,
        oauth: /* true only if both OAUTH_GOOGLE_* are set — computed at import time via a factory wrapper */ ...,
      },
      extraProviders: [
        { provide: BYMAX_AUTH_USER_REPOSITORY, useClass: PrismaUserRepository },
        { provide: BYMAX_AUTH_PLATFORM_USER_REPOSITORY, useClass: PrismaPlatformUserRepository },
        { provide: BYMAX_AUTH_EMAIL_PROVIDER, useClass: chooseEmailProviderClass() /* Mailpit | Resend */ },
        { provide: BYMAX_AUTH_HOOKS, useClass: AppAuthHooks },
      ],
    })
    ```
  - Re-exports the library for downstream modules that need its decorators.
- [ ] `apps/api/src/app.module.ts` — imports `AuthModule`, `ThrottlerModule.forRoot(AUTH_THROTTLE_CONFIGS)`, `TenantsModule`, `ProjectsModule`.
- [ ] Global guards registered in order (APP_GUARD providers):
  1. `JwtAuthGuard` (library) — `@Public()` bypass works.
  2. `UserStatusGuard` (library) — blocks `blockedStatuses`.
  3. `MfaRequiredGuard` (library) — honors `@SkipMfa()`.
  4. `RolesGuard` (library) — honors `@Roles(...)`.
- [ ] `apps/api/src/tenants/` — example domain module:
  - `TenantsController` with `GET /api/tenants/me` (lists tenants the current user belongs to), `POST /api/tenants` (OWNER-gated).
  - Uses `@CurrentUser()`, `@Roles('OWNER')`.
- [ ] `apps/api/src/projects/` — example domain:
  - `ProjectsController` under `/api/projects`.
  - `GET` → lists projects in current tenant, `POST` requires `@Roles('ADMIN')`, `DELETE /:id` requires `SelfOrAdminGuard` (owner or admin).
  - Repository uses Prisma directly, scoped by `tenantId` from `req.user.tenantId`.
- [ ] Demo endpoint for Feature #16: `POST /api/debug/lockout` (only active when `NODE_ENV !== 'production'`) that hammers `bf:` Redis keys so the UI can demo lockout deterministically.
- [ ] Demo endpoint for Feature #23: `PATCH /api/users/:id/status` gated by `@Roles('ADMIN')` — updates user status via `PrismaUserRepository.updateStatus` so admins can demo suspension.
- [ ] Shared error filter: maps library `AuthException` → consistent JSON `{ code, message, statusCode }` with codes from `AUTH_ERROR_CODES`.

**Definition of done.** All auth endpoints under `/api/auth/*` respond. Supertest smoke tests for `register → verify email → login → get me → logout → refresh` pass (Phase 17 will formalize the full suite).

---

## Phase 8 — OAuth (Google) & Invitations Backends

**Goal.** Cover Matrix rows #12 (OAuth Google + link) and #21 (invitations).

**Prerequisites.** Phase 7.

**Deliverables.**

- [ ] Env: `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`, `OAUTH_GOOGLE_CALLBACK_URL` added to `.env.example`.
- [ ] `auth.config.ts` `oauth.google` block activated when all three are set.
- [ ] `controllers: { oauth: true }` flipped on in `AuthModule` by the same env-presence check.
- [ ] Frontend callback URL documented: `https://<web-host>/auth/oauth/callback?provider=google` redirects into the API's `GET /api/auth/oauth/google/callback`. The proxy handles cookie propagation.
- [ ] Account linking demonstrated: user registers with email `x@example.com`, later clicks "Continue with Google" using the same email → existing row is updated with `oauthProvider='google'`, `oauthProviderId=...`.
- [ ] Invitations:
  - `controllers: { invitations: true }` in config (already resolved via `invitations.enabled: true`).
  - Custom logic not required — library mounts `/api/auth/invitations` + `/api/auth/invitations/accept`.
  - `IAuthHooks.afterInvitationAccepted` writes audit log entry.
  - Admin-gate on the creation side via `@Roles('ADMIN')` (library handles this; document in `docs/FEATURES.md`).

**Definition of done.** E2E:
- OAuth: launching `GET /api/auth/oauth/google` redirects to Google's `accounts.google.com`; callback (mocked in tests) logs the user in and sets cookies.
- Invitations: admin creates invitation → Mailpit captures email → recipient hits `/api/auth/invitations/accept` with token → new user row appears in Prisma.

---

## Phase 9 — Platform Admin Context (Backend)

**Goal.** Matrix row #22 (platform admin) live.

**Prerequisites.** Phase 7.

**Deliverables.**

- [ ] `auth.config.ts` already sets `platform.enabled: true` and `roles.platformHierarchy`.
- [ ] Library auto-mounts `/api/auth/platform/*` routes.
- [ ] `apps/api/src/platform/platform.module.ts` — example endpoints:
  - `GET /api/platform/tenants` — lists all tenants (protected by `JwtPlatformGuard` + `@PlatformRoles('SUPER_ADMIN', 'SUPPORT')`).
  - `GET /api/platform/users?tenantId=...` — lists users in a tenant.
  - `PATCH /api/platform/users/:id/status` — suspend/unsuspend from the platform side.
  - Every mutation writes an `AuditLog` entry via `AppAuthHooks` (`afterLogout`, `afterLogin` already covered; custom platform events written directly).
- [ ] Ensure platform JWT payload (`role: 'SUPER_ADMIN'`) never leaks into dashboard-guarded routes — add an e2e test that asserts `JwtAuthGuard` rejects a platform token on `/api/projects` (Phase 17).

**Definition of done.** `POST /api/auth/platform/login` with seeded super-admin credentials returns tokens; `GET /api/platform/tenants` returns the list; the same token fails on `GET /api/projects`.

---

## Phase 10 — WebSocket Auth (Backend)

**Goal.** Matrix row #24 (WebSocket auth + `WsJwtGuard`).

**Prerequisites.** Phase 7.

**Deliverables.**

- [ ] `apps/api/src/notifications/notifications.gateway.ts`:
  - `@WebSocketGateway({ cors: true, path: '/ws/notifications' })`.
  - `@UseGuards(WsJwtGuard)` on `handleConnection` or via `afterInit` depending on library recommendations.
  - Events: `notification:new` emitted by a test controller `POST /api/debug/notify/:userId` (dev only).
- [ ] Reads JWT from the `access_token` cookie on the upgrade request (library guard handles this).
- [ ] Disconnects clients whose status flips to `SUSPENDED` (hook into `IAuthHooks.onSessionEvicted` or status change to disconnect).

**Definition of done.** A `websocat` session authenticated via cookie receives a pushed message when `POST /api/debug/notify/:userId` is called.

---

## Phase 11 — `apps/web` Skeleton (Next.js 16 + Tailwind + shadcn/ui)

**Goal.** Runnable Next.js app serving a landing page. No auth wiring yet.

**Prerequisites.** Phase 2.

**Deliverables.**

- [ ] `apps/web/package.json`:
  - `"type": "module"`.
  - Dependencies: `next@^16`, `react@^19`, `react-dom@^19`, `@bymax-one/nest-auth` (linked), `zod`, `react-hook-form`, `@hookform/resolvers`, `lucide-react`, `date-fns`, `sonner` (toasts), `socket.io-client` (for Phase 16 — or native `WebSocket` if the gateway is plain WS).
  - Dev: `typescript@^5`, `eslint-config-next`, `tailwindcss@^4`, `@tailwindcss/postcss`, `autoprefixer`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `playwright`, `@playwright/test`.
- [ ] `apps/web/next.config.mjs`:
  - `experimental.reactCompiler: true` (Next 16 default).
  - Rewrites: `/api/:path*` → `${INTERNAL_API_URL}/api/:path*` (server-side only; browser talks to same-origin `/api/*`).
- [ ] `apps/web/tsconfig.json` (extends root base; `paths: { "@/*": ["./*"] }`).
- [ ] `apps/web/tailwind.config.ts` + `apps/web/app/globals.css` (Tailwind v4 directives).
- [ ] `apps/web/components/ui/` — shadcn/ui components generated (button, input, form, dialog, toast, dropdown-menu, avatar, card, tabs, badge, tooltip). Document the `npx shadcn@latest add ...` commands in `docs/GETTING_STARTED.md`.
- [ ] `apps/web/app/layout.tsx` — HTML shell, font (Geist or Inter).
- [ ] `apps/web/app/page.tsx` — marketing landing ("Welcome. See /auth/login.").
- [ ] `apps/web/lib/env.ts` — zod schema for `NEXT_PUBLIC_API_URL`, `INTERNAL_API_URL`, `AUTH_JWT_SECRET_FOR_PROXY` (mirror, HS256, used by edge helpers), cookie names, etc. Loads at startup, freezes values.

**Definition of done.** `pnpm --filter @nest-auth-example/web dev` serves `http://localhost:3000` with the landing page.

---

## Phase 12 — Frontend Auth Wiring (Client, Provider, Proxy, Refresh, Logout)

**Goal.** Matrix rows #25 (hooks), #26 (edge proxy), #27 (silent + client refresh), #28 (logout handler).

**Prerequisites.** Phase 11.

**Deliverables.**

### 12.1 Typed auth client

- [ ] `apps/web/lib/auth-client.ts`:
  - `createAuthClient({ baseUrl: '/api', routePrefix: 'auth', credentials: 'include' })`.
  - One exported singleton `authClient` used by both `AuthProvider` and page logic.
  - Wraps `AuthClientError` → toast + redirect helpers.

### 12.2 React provider

- [ ] `apps/web/app/providers.tsx`:
  - Wraps with `<AuthProvider client={authClient} onSessionExpired={...}>`.
  - Also installs `sonner` toaster.
- [ ] `apps/web/app/layout.tsx` — mounts `<Providers>`.

### 12.3 Next.js proxy (edge middleware)

- [ ] `apps/web/proxy.ts` (the library uses `proxy.ts` — keep that name per OVERVIEW §5):
  - `createAuthProxy({...})` with:
    - `publicRoutes: ['/', '/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password', '/auth/verify-email', '/auth/accept-invitation', '/platform/login']`.
    - `publicRoutesRedirectIfAuthenticated: ['/auth/login', '/auth/register']`.
    - `protectedRoutes`:
      - `{ pattern: '/dashboard/:path*', allowedRoles: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] }`.
      - `{ pattern: '/dashboard/team/:path*', allowedRoles: ['OWNER', 'ADMIN'] }`.
      - `{ pattern: '/dashboard/invitations', allowedRoles: ['OWNER', 'ADMIN'] }`.
      - `{ pattern: '/platform/:path*', allowedRoles: ['SUPER_ADMIN', 'SUPPORT'] }` (with `context: 'platform'` if supported; otherwise lean on the separate platform cookie names).
    - `loginPath: '/auth/login'`.
    - `getDefaultDashboard: (role) => role.startsWith('PLATFORM') ? '/platform' : '/dashboard'`.
    - `apiBase: env.INTERNAL_API_URL`.
    - `jwtSecret: env.AUTH_JWT_SECRET_FOR_PROXY`.
    - `blockedUserStatuses: ['BANNED', 'INACTIVE', 'SUSPENDED']`.
  - Exports both `middleware` (calling `proxy`) and `config.matcher` excluding `_next/static`, `_next/image`, `favicon.ico`, `public/*`.
- [ ] `apps/web/middleware.ts` — one-liner re-export.

### 12.4 Route handlers

- [ ] `apps/web/app/api/auth/silent-refresh/route.ts` — `export const GET = createSilentRefreshHandler({...})`.
- [ ] `apps/web/app/api/auth/client-refresh/route.ts` — `export const POST = createClientRefreshHandler({...})`.
- [ ] `apps/web/app/api/auth/logout/route.ts` — `export const POST = createLogoutHandler({ apiBase: env.INTERNAL_API_URL, redirect: { to: '/auth/login' } })`.

### 12.5 Helper hooks & utilities

- [ ] `apps/web/lib/require-auth.ts` — server helper that `redirect('/auth/login')` if user headers (`x-user-id` injected by the proxy) are absent.
- [ ] `apps/web/components/auth/sign-out-button.tsx` — posts to `/api/auth/logout` then router.refresh.

**Definition of done.** Manually navigating to `/dashboard` redirects to `/auth/login`; a valid cookie pair (set by hitting the API directly) lets the same route render.

---

## Phase 13 — Public Auth Pages (`app/(auth)`)

**Goal.** Every public auth flow the library ships is demonstrated with a polished UI. Matrix rows: #1, #2, #5, #6, #7, #9, #12 (button on login/register), #21 (accept-invitation page), #29.

**Prerequisites.** Phase 12.

**Deliverables.** Every page ships with:

- Form using `react-hook-form` + zod schema in `apps/web/lib/schemas/auth.ts`.
- Submit handler calls the matching `authClient.*` method.
- Errors translated from `AUTH_ERROR_CODES` via a single `apps/web/lib/auth-errors.ts` map. The map covers **all** codes in `AUTH_ERROR_CODES`.
- Server-side redirect if the user is already logged in (handled by the proxy's `publicRoutesRedirectIfAuthenticated`).

**Pages.**

- [ ] `app/(auth)/layout.tsx` — centered card layout + brand.
- [ ] `app/(auth)/login/page.tsx` — email + password, "Continue with Google" button (hidden when OAuth env not set), "Forgot password?" link. On MFA challenge, redirects to `/auth/mfa-challenge` carrying the `mfaTempToken` in `sessionStorage` (never cookie).
- [ ] `app/(auth)/register/page.tsx` — email + name + password + tenant selection (dropdown) or tenant fixed (single-tenant demo); posts to `authClient.register` → shows verification-email-sent screen.
- [ ] `app/(auth)/verify-email/page.tsx` — OTP input (six single-character boxes), resend button with cooldown (uses `authClient.resendVerification`). Accepts `?email=&tenantId=` query.
- [ ] `app/(auth)/forgot-password/page.tsx` — single email input; posts to `authClient.forgotPassword`. Shows an anti-enumeration-friendly success message always.
- [ ] `app/(auth)/reset-password/page.tsx` — supports both modes via `?mode=token&token=...` or `?mode=otp&email=...`. Renders OTP box or password-only form accordingly; calls `authClient.resetPassword`.
- [ ] `app/(auth)/mfa-challenge/page.tsx` — TOTP input + "Use recovery code instead"; calls `authClient.mfaChallenge`.
- [ ] `app/(auth)/accept-invitation/page.tsx` — reads `?token=...`, shows invite summary, collects name + password, calls the library's accept endpoint.
- [ ] Shared `<OtpInput />` component in `components/auth/otp-input.tsx`.
- [ ] Shared `<PasswordInput />` with show/hide + strength hint (the library owns minimum strength validation; this is UX only).

**Definition of done.** A full signup → verify email (via Mailpit UI) → login → MFA challenge walk-through succeeds in the browser, with no console errors.

---

## Phase 14 — Dashboard: Account, Security, Sessions, Team, Invitations

**Goal.** Matrix rows: #4 (revoke all), #8/#10/#11 (MFA enroll/recovery/disable), #13/#14/#15 (sessions), #20 (tenant switcher), #21 (admin invitations page), #23 (admin suspends user), #25 (hooks used), #29 (errors).

**Prerequisites.** Phases 12, 13.

**Deliverables.**

### 14.1 Dashboard shell

- [ ] `app/dashboard/layout.tsx`:
  - Uses `require-auth.ts` helper.
  - Sidebar with nav: Overview, Projects, Team, Invitations (admin-gated), Sessions, Security, Account. Nav items hidden based on `useSession().user.role`.
  - Top-right: `<TenantSwitcher />` + avatar menu with "Sign out".
- [ ] `<TenantSwitcher />` (`components/auth/tenant-switcher.tsx`):
  - Lists tenants the user belongs to (calls `GET /api/tenants/me`).
  - On switch, persists the chosen tenant ID in a client cookie (non-HttpOnly), which the axios/fetch wrapper forwards as `X-Tenant-Id`.

### 14.2 Account

- [ ] `app/dashboard/account/page.tsx`:
  - Profile (name, email — read-only here; email change is out of scope for this example and documented).
  - Password change form: requires current password, new password, confirm.
  - Uses a custom `POST /api/account/change-password` endpoint in `apps/api/src/account/` that validates the current password via `PasswordService` (library-exposed? — if not, validate via re-login then call `updatePassword`). **Document the approach taken in `docs/FEATURES.md`.**

### 14.3 Security (MFA)

- [ ] `app/dashboard/security/page.tsx`:
  - Shows "MFA is / is not enabled" based on `useSession().user.mfaEnabled`.
  - Setup flow:
    1. `POST /api/auth/mfa/setup` → `{ otpauthUri, secret }`.
    2. Render QR (use a tiny inline QR renderer or `qrcode` package; **do not** send the secret to a third-party service).
    3. User enters TOTP code → `POST /api/auth/mfa/verify-enable`.
    4. Modal displays the 8 recovery codes — user must confirm they saved them before leaving (`Download .txt` + `I saved them` button).
  - Disable flow: `POST /api/auth/mfa/disable` (OTP re-confirmation).

### 14.4 Sessions

- [ ] `app/dashboard/sessions/page.tsx`:
  - Lists active sessions via `GET /api/auth/sessions` (device, IP, createdAt, lastSeenAt).
  - `Revoke` per session → `DELETE /api/auth/sessions/:id`.
  - `Sign out everywhere` → `DELETE /api/auth/sessions/all` (revokes all refresh tokens + JWT blacklist entries; covers Matrix #4).

### 14.5 Team

- [ ] `app/dashboard/team/page.tsx`:
  - Lists users in current tenant with role.
  - Admin-only: change user status (active/suspended) via `PATCH /api/users/:id/status` — demonstrates Matrix #23.
  - Uses optimistic updates with rollback on error.

### 14.6 Invitations

- [ ] `app/dashboard/invitations/page.tsx`:
  - Admin-only.
  - Form: invite by email + role.
  - Table of pending + accepted invitations.
  - Resend + revoke actions.

### 14.7 Projects (toy domain)

- [ ] `app/dashboard/projects/page.tsx` — lists projects in current tenant, admin can create/delete. Demonstrates Matrix #18/#19/#20 end to end.

**Definition of done.** A member (seeded from Phase 4) can log in, enroll in MFA, log out, log back in with TOTP, switch tenants, and see their projects filtered per tenant.

---

## Phase 15 — Platform Admin Area (Frontend)

**Goal.** Matrix row #22.

**Prerequisites.** Phase 9 + Phase 12.

**Deliverables.**

- [ ] `app/platform/login/page.tsx` — separate login form posting to `/api/auth/platform/login`. Cookies named differently from dashboard (library handles cookie naming via options; document in `docs/ARCHITECTURE.md`).
- [ ] `app/platform/layout.tsx` — separate shell; visually distinct header to make it obvious it's a different context.
- [ ] `app/platform/tenants/page.tsx` — list all tenants.
- [ ] `app/platform/users/page.tsx` — pick tenant, list users, suspend/unsuspend.
- [ ] Sign-out posts to `/api/auth/logout` with platform cookies scoped correctly.
- [ ] Proxy rules (Phase 12) already gate `/platform/*` to `SUPER_ADMIN` / `SUPPORT`.

**Definition of done.** A super-admin can log into `/platform/login`, see tenants, suspend a user; the suspended user is kicked on their next request to `/api/*`.

---

## Phase 16 — WebSocket Consumer + Notification Toast

**Goal.** Matrix row #24, client side.

**Prerequisites.** Phases 10, 14.

**Deliverables.**

- [ ] `apps/web/lib/ws-client.ts` — opens a `WebSocket` (or Socket.IO) connection to `${NEXT_PUBLIC_WS_URL}/ws/notifications`. The access-token cookie travels automatically on the upgrade request.
- [ ] `components/notifications/notification-listener.tsx` — client component mounted in the dashboard layout; on each `notification:new` message, fires a toast via `sonner`.
- [ ] Demo button on `/dashboard/account` that calls `POST /api/debug/notify/self` (dev-only) so the full loop is clickable.

**Definition of done.** Clicking the demo button raises a toast in the same browser session; opening a second tab logged in as a different user never receives that message.

---

## Phase 17 — Testing (Unit, E2E, Playwright)

**Goal.** Guarantee every demonstrated feature keeps working. Matrix rows #14 (FIFO eviction assertion), #16 (lockout), and error-code paths are best verified here.

**Prerequisites.** Phases 7–16.

**Deliverables.**

### 17.1 `apps/api` unit tests (Jest)

- [ ] `prisma-user.repository.spec.ts` — covers each method, including mapping edge cases (null `passwordHash` for OAuth users, empty `mfaRecoveryCodes`).
- [ ] `prisma-platform-user.repository.spec.ts`.
- [ ] `mailpit-email.provider.spec.ts` / `resend-email.provider.spec.ts` — mock SMTP / mock Resend client.
- [ ] `app-auth.hooks.spec.ts` — asserts `AuditLog` rows are written with correct event slugs for each hook.
- [ ] `auth.config.spec.ts` — asserts zod validation rejects short `JWT_SECRET`, non-base64 `MFA_ENCRYPTION_KEY`, etc.
- [ ] Domain module tests (`tenants`, `projects`) for role gates.

### 17.2 `apps/api` e2e tests (supertest + real Postgres/Redis via `docker-compose.test.yml`)

- [ ] One spec file per Matrix row. Example list:
  - `register-and-verify.e2e-spec.ts`.
  - `login-and-logout.e2e-spec.ts`.
  - `refresh-rotation.e2e-spec.ts` — includes grace-window race.
  - `jwt-revocation.e2e-spec.ts`.
  - `password-reset-token.e2e-spec.ts`.
  - `password-reset-otp.e2e-spec.ts`.
  - `mfa-setup-challenge-disable.e2e-spec.ts`.
  - `recovery-codes.e2e-spec.ts`.
  - `oauth-google.e2e-spec.ts` — Google exchange mocked via an HTTP fixture server.
  - `sessions-list-revoke.e2e-spec.ts`.
  - `session-fifo-eviction.e2e-spec.ts` — creates `defaultMaxSessions + 1` sessions, asserts oldest is evicted and `onSessionEvicted` hook fired.
  - `brute-force-lockout.e2e-spec.ts`.
  - `throttle-demo.e2e-spec.ts`.
  - `rbac.e2e-spec.ts` — validates hierarchy (`OWNER` can do `VIEWER` things).
  - `tenant-isolation.e2e-spec.ts` — user from tenant A cannot read tenant B's projects.
  - `invitations.e2e-spec.ts`.
  - `platform-auth-isolation.e2e-spec.ts`.
  - `status-enforcement.e2e-spec.ts`.
  - `websocket-auth.e2e-spec.ts`.
- [ ] Test bootstrap: spins `PrismaService` against `DATABASE_URL_TEST`, runs `prisma migrate deploy`, truncates between suites.
- [ ] Mailpit assertion helper — polls `http://localhost:58025/api/v1/messages` for captured emails.

### 17.3 `apps/web` unit tests (Vitest)

- [ ] Schema tests: login, register, reset-password.
- [ ] Auth error-map coverage test — asserts every key in `AUTH_ERROR_CODES` has a matching message in `auth-errors.ts`.
- [ ] `<OtpInput />` component tests.

### 17.4 `apps/web` e2e tests (Playwright)

- [ ] `login-happy-path.spec.ts`.
- [ ] `login-wrong-password-shows-error.spec.ts`.
- [ ] `forgot-password.spec.ts` — reads token out of Mailpit.
- [ ] `mfa-enroll-and-login.spec.ts` — uses `otplib` to generate TOTPs.
- [ ] `invitations.spec.ts` — admin invites, new browser context accepts.
- [ ] `platform-admin.spec.ts`.
- [ ] `tenant-switcher.spec.ts`.
- [ ] Playwright fixture `auth.ts` that performs cookie-based login once and reuses storage state across specs.

**Definition of done.** `pnpm test && pnpm test:e2e` pass locally and in CI against `docker-compose.test.yml`. Overall coverage ≥ 80% per app; `apps/api/src/auth/` coverage ≥ 90%.

---

## Phase 18 — Documentation (docs/*)

**Goal.** Every document promised by `docs/OVERVIEW.md` §5 exists and is accurate.

**Prerequisites.** Phase 17 (so screenshots/walkthroughs match the real UI).

**Deliverables.** New files, all under `docs/`:

- [ ] `GETTING_STARTED.md` — 5-minute quickstart. Covers: prereqs, clone, `scripts/link-library.sh`, `pnpm install`, `pnpm infra:up`, `pnpm --filter api prisma:migrate dev`, `pnpm --filter api prisma:seed`, `pnpm dev`, login with seeded credentials, Mailpit URL.
- [ ] `FEATURES.md` — one section per Matrix row. Each section has:
  - A short prose intro.
  - The library API used (with file:line into `apps/api` or `apps/web`).
  - A reproducible user journey (click-by-click or `curl` sequence).
  - Screenshots where relevant (committed under `docs/assets/`).
- [ ] `ARCHITECTURE.md` — module boundaries, which subpath of the library lives where, request/cookie diagrams (expand from OVERVIEW §3).
- [ ] `ENVIRONMENT.md` — full env-var reference (Appendix A of this plan, kept in sync).
- [ ] `DATABASE.md` — explains the Prisma schema, why each field exists, and the exact library mapping.
- [ ] `REDIS.md` — key namespaces + TTLs table (expand from OVERVIEW §11). Documents the `nest-auth-example:*` prefix.
- [ ] `EMAIL.md` — swapping Mailpit → Resend, template overrides, locale handling.
- [ ] `DEPLOYMENT.md` — production checklist (summarize OVERVIEW §14 + add: Redis persistence, HTTPS, cookie domain strategy, JWT rotation, secret rotation with `jwt.previousSecrets`).
- [ ] `TROUBLESHOOTING.md` — common errors mapped to fixes (`JWT_SECRET` too short, CORS issues, cookies not sticking, Mailpit not reachable).
- [ ] `RELEASES.md` — library-version ↔ example-commit table.
- [ ] Update `docs/OVERVIEW.md` §6 status column as each row goes green.

**Definition of done.** A reviewer clones the repo on a clean machine and reaches "logged in as admin@acme.test" following `GETTING_STARTED.md` alone.

---

## Phase 19 — CI/CD, Release Automation, Production Build

**Goal.** Reproducible green builds on every push; branch `main` always deployable.

**Prerequisites.** Phase 17.

**Deliverables.**

- [ ] `.github/workflows/ci.yml`:
  - Triggers: `push` + `pull_request`.
  - Matrix: Node 24, pnpm 10.
  - Services: postgres:18 + redis:7 via GitHub Actions services.
  - Jobs:
    1. `install` — cached pnpm install.
    2. `lint` — `pnpm lint`.
    3. `typecheck` — `pnpm typecheck`.
    4. `unit` — `pnpm test`.
    5. `e2e-api` — boot `docker-compose.test.yml`, run supertest suites.
    6. `e2e-web` — Playwright install browsers, boot both apps, run Playwright suites.
    7. `coverage-report` — aggregates coverage, uploads artifact.
    8. `export-usage-check` — Phase 20 audit script (runs here, fails the build if any library export is unused).
- [ ] `.github/workflows/release.yml`:
  - Triggers on tag `v*`.
  - Builds production Docker images for `apps/api` and `apps/web`, pushes to GHCR.
  - Updates `docs/RELEASES.md` via a bot commit.
- [ ] `Dockerfile` per app (`apps/api/Dockerfile`, `apps/web/Dockerfile`) — multi-stage, non-root, `NODE_ENV=production`.
- [ ] `docker-compose.prod.yml` — optional, reproduces the production topology locally for smoke tests.
- [ ] `renovate.json` or Dependabot config to track `@bymax-one/nest-auth` once it ships to npm.

**Definition of done.** A green badge on `main`; protected branch disallows merges on red.

---

## Phase 20 — Coverage Audit & Hardening

**Goal.** Prove the claim made in OVERVIEW §6: "every public export from `@bymax-one/nest-auth` … is referenced from at least one file."

**Prerequisites.** Phase 19.

**Deliverables.**

- [ ] `scripts/audit-library-exports.mjs`:
  - Parses the library's `dist/*/index.d.ts` (or source exports) to enumerate every exported symbol per subpath.
  - Greps the `apps/` tree for each symbol. Fails with a diff if any are missing.
  - Runs in CI (`export-usage-check` job in Phase 19).
- [ ] Fix any gaps surfaced by the audit. Each gap either:
  - Gets wired into an existing page/module, **or**
  - Is explicitly listed in `docs/FEATURES.md` as "intentionally not demonstrated — see #N", with a GitHub issue reference.
- [ ] Final security pass:
  - Cookies: `HttpOnly`, `Secure` in production, `SameSite=Lax` (Strict where possible), refresh cookie path scoped to `/api/auth`.
  - Headers: `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy` set via middleware on `apps/web` and helmet on `apps/api`.
  - Log sanitization: the `sanitizeHeaders` library helper is used everywhere request/response headers are logged.
  - Error messages: anti-enumeration maintained (login errors use `INVALID_CREDENTIALS` generically).
- [ ] `CHANGELOG.md` entry: `1.0.0 — initial reference app tracking @bymax-one/nest-auth@1.0.0`.
- [ ] Tag `v1.0.0` on `main` once all previous items are green.

**Definition of done.** `scripts/audit-library-exports.mjs` exits 0 in CI; all production security items are implemented and documented.

---

## Appendix A — Environment Variable Registry

> Every variable listed here must appear in `.env.example` with a safe default or an explicit `REQUIRED` placeholder. The zod schema in `apps/api/src/config/env.schema.ts` and `apps/web/lib/env.ts` is the enforcement surface.

### Shared

| Var | Required | Example | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | ✓ | `development` | `development` / `test` / `production` |
| `LOG_LEVEL` | ✗ | `info` | `fatal`/`error`/`warn`/`info`/`debug`/`trace` |
| `PUBLIC_DOMAIN` | ✗ | `example.com` | Used by `cookies.resolveDomains` in prod |

### `apps/api`

| Var | Required | Example | Notes |
| --- | --- | --- | --- |
| `API_PORT` | ✓ | `4000` | |
| `DATABASE_URL` | ✓ | `postgres://postgres:postgres@localhost:5432/example_app` | |
| `DATABASE_URL_TEST` | ✗ | `postgres://...:55432/example_app_test` | For e2e |
| `REDIS_URL` | ✓ | `redis://localhost:6379` | |
| `JWT_SECRET` | ✓ | *32+ chars, high entropy* | `openssl rand -hex 64` |
| `MFA_ENCRYPTION_KEY` | ✓ (when mfa) | *base64 32 bytes* | `openssl rand -base64 32` |
| `EMAIL_PROVIDER` | ✗ | `mailpit` | `mailpit` \| `resend` |
| `SMTP_HOST` | ✓ if mailpit | `localhost` | |
| `SMTP_PORT` | ✓ if mailpit | `1025` | |
| `SMTP_FROM` | ✓ | `no-reply@nest-auth-example.dev` | |
| `RESEND_API_KEY` | ✓ if resend | | |
| `OAUTH_GOOGLE_CLIENT_ID` | ✗ | | Presence flips OAuth on |
| `OAUTH_GOOGLE_CLIENT_SECRET` | ✗ | | |
| `OAUTH_GOOGLE_CALLBACK_URL` | ✗ | `http://localhost:4000/api/auth/oauth/google/callback` | |
| `PASSWORD_RESET_METHOD` | ✗ | `token` | `token` \| `otp` |

### `apps/web`

| Var | Required | Example | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | ✓ | `http://localhost:3000/api` | Browser-visible |
| `INTERNAL_API_URL` | ✓ | `http://localhost:4000` | Server-to-server only |
| `AUTH_JWT_SECRET_FOR_PROXY` | ✓ | *same as API `JWT_SECRET`* | Edge middleware verifies HS256 |
| `NEXT_PUBLIC_WS_URL` | ✗ | `ws://localhost:4000` | WebSocket base |
| `NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED` | ✗ | `false` | Shows/hides UI button |

---

## Appendix B — Library Export → Example File Map

> Minimum target for Phase 20 audit. One line per public export; the file column tells the auditor where to look first.

### From `@bymax-one/nest-auth` (server)

| Export | Kind | First-class home in the example |
| --- | --- | --- |
| `BymaxAuthModule` | Module | `apps/api/src/auth/auth.module.ts` |
| `BYMAX_AUTH_USER_REPOSITORY` | Token | `apps/api/src/auth/auth.module.ts` |
| `BYMAX_AUTH_PLATFORM_USER_REPOSITORY` | Token | `apps/api/src/auth/auth.module.ts` |
| `BYMAX_AUTH_EMAIL_PROVIDER` | Token | `apps/api/src/auth/auth.module.ts` |
| `BYMAX_AUTH_HOOKS` | Token | `apps/api/src/auth/auth.module.ts` |
| `BYMAX_AUTH_REDIS_CLIENT` | Token | `apps/api/src/redis/redis.provider.ts` |
| `BYMAX_AUTH_OPTIONS` | Token | `apps/api/src/auth/auth.config.ts` (consumed if needed) |
| `AuthService` / `SessionService` / `MfaService` / `OAuthService` / `PasswordResetService` / `TokenManagerService` / `OtpService` / `PasswordService` / `TokenDeliveryService` | Service | Implicitly mounted by module; smoke-test in e2e |
| `JwtAuthGuard` / `JwtPlatformGuard` / `RolesGuard` / `PlatformRolesGuard` / `MfaRequiredGuard` / `UserStatusGuard` / `OptionalAuthGuard` / `SelfOrAdminGuard` / `WsJwtGuard` | Guard | `apps/api/src/projects/projects.controller.ts` + `apps/api/src/notifications/notifications.gateway.ts` |
| `@Public` / `@CurrentUser` / `@Roles` / `@PlatformRoles` / `@SkipMfa` | Decorator | `apps/api/src/projects/*` + `apps/api/src/platform/*` |
| `RegisterDto` / `LoginDto` / `MfaChallengeDto` / `MfaDisableDto` / `CreateInvitationDto` / `AcceptInvitationDto` / `ForgotPasswordDto` / `ResetPasswordDto` / `VerifyEmailDto` / `VerifyOtpDto` / `ResendVerificationDto` / `ResendOtpDto` / `PlatformLoginDto` | DTO | Used by library controllers; schema assertions in e2e |
| `IUserRepository` / `IPlatformUserRepository` / `IEmailProvider` / `IAuthHooks` | Interface | `apps/api/src/auth/prisma-user.repository.ts` / `prisma-platform-user.repository.ts` / `mailpit-email.provider.ts` / `app-auth.hooks.ts` |
| `AUTH_ERROR_CODES` / `AuthException` | Errors | `apps/api/src/auth/auth-exception.filter.ts` |
| `AUTH_THROTTLE_CONFIGS` | Config | `apps/api/src/app.module.ts` (ThrottlerModule) |
| `NoOpAuthHooks` / `NoOpEmailProvider` | Fallback | Referenced in `docs/FEATURES.md` + a unit test |
| `encrypt` / `decrypt` / `sha256` / `hmacSha256` / `generateSecureToken` / `timingSafeCompare` | Crypto | Used in a test helper (`apps/api/test/crypto-roundtrip.spec.ts`) |
| `hasRole` / `sanitizeHeaders` / `sleep` | Util | Logger middleware + RBAC tests |

### From `@bymax-one/nest-auth/shared`

| Export | Home |
| --- | --- |
| `AUTH_ERROR_CODES` / `AuthClientError` / `AuthErrorResponse` | `apps/web/lib/auth-errors.ts` |
| Cookie & route constants | `apps/web/proxy.ts`, `apps/web/lib/auth-client.ts` |
| JWT payload types | `apps/web/middleware.ts` (typed decoder), `apps/api` typing |

### From `@bymax-one/nest-auth/client`

| Export | Home |
| --- | --- |
| `createAuthClient` / `createAuthFetch` / `AuthClient` / `AuthClientConfig` / input types | `apps/web/lib/auth-client.ts` |

### From `@bymax-one/nest-auth/react`

| Export | Home |
| --- | --- |
| `AuthProvider` | `apps/web/app/providers.tsx` |
| `useSession` / `useAuth` / `useAuthStatus` | `apps/web/components/auth/*`, `apps/web/app/dashboard/**` |

### From `@bymax-one/nest-auth/nextjs`

| Export | Home |
| --- | --- |
| `createAuthProxy` | `apps/web/proxy.ts` |
| `createSilentRefreshHandler` / `SILENT_REFRESH_ROUTE` | `apps/web/app/api/auth/silent-refresh/route.ts` |
| `createClientRefreshHandler` / `CLIENT_REFRESH_ROUTE` | `apps/web/app/api/auth/client-refresh/route.ts` |
| `createLogoutHandler` / `LOGOUT_ROUTE` | `apps/web/app/api/auth/logout/route.ts` |
| `decodeJwtToken` / `verifyJwtToken` / `isTokenExpired` / `getUserId` / `getUserRole` / `getTenantId` | `apps/web/lib/require-auth.ts` (server helper) |
| `isBackgroundRequest` / `buildSilentRefreshUrl` / `parseSetCookieHeader` / `dedupeSetCookieHeaders` / `getSetCookieHeaders` | Covered by proxy tests |

---

**End of plan.** Before execution, confirm:

1. The `@bymax-one/nest-auth` version referenced throughout (`^1.0.0`) matches the library checkout at `../nest-auth`.
2. The phase ordering in §1 is acceptable, or propose a re-ordering (e.g., parallelizing Phase 8 earlier).
3. Any Matrix row in OVERVIEW §6 that should be descoped for v1 — say so now; it will be moved to a follow-up plan rather than executed.
