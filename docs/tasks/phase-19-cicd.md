# Phase 19 — CI/CD, Release Automation, Production Build — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-19--cicd-release-automation-production-build) §Phase 19
> **Total tasks:** 5
> **Progress:** 🔴 0 / 5 done (0%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID | Task | Status | Priority | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| P19-1 | `.github/workflows/ci.yml` — push/PR pipeline | 🔴 | High | M | Phase 17 |
| P19-2 | `.github/workflows/release.yml` — tag-driven release | 🔴 | High | M | P19-1, P19-3, P19-4 |
| P19-3 | `apps/api/Dockerfile` — multi-stage production image | 🔴 | High | M | Phase 7 |
| P19-4 | `apps/web/Dockerfile` — multi-stage production image | 🔴 | High | M | Phase 14 |
| P19-5 | `docker-compose.prod.yml` + Renovate config | 🔴 | Medium | S | P19-3, P19-4 |

---

## P19-1 — `.github/workflows/ci.yml` — push/PR pipeline

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `Phase 17`

### Description
GitHub Actions pipeline that runs on every push and pull_request. Uses Node 24 + pnpm 10, with `postgres:18` and `redis:7` services. Jobs must run in the exact order specified by `docs/DEVELOPMENT_PLAN.md` §19: `install → lint → typecheck → unit → e2e-api → e2e-web → coverage-report → export-usage-check`.

### Acceptance Criteria
- [ ] `.github/workflows/ci.yml` exists.
- [ ] `on: [push, pull_request]` with `pull_request` targeting `main` and `next`.
- [ ] `runs-on: ubuntu-latest`; `pnpm/action-setup@v4` at version `10.x`; `actions/setup-node@v4` at `node-version: 24`.
- [ ] Services block provides `postgres:18` (env `POSTGRES_DB=example_app_test`) and `redis:7` with health-checks; env injected into subsequent jobs via `DATABASE_URL_TEST` and `REDIS_URL`.
- [ ] Jobs in this order and named exactly: `install`, `lint`, `typecheck`, `unit`, `e2e-api`, `e2e-web`, `coverage-report`, `export-usage-check`.
- [ ] `install` caches pnpm store; subsequent jobs `needs: install` and restore cache.
- [ ] `e2e-api` boots `docker-compose.test.yml`, runs migrations, executes `pnpm --filter api test:e2e`.
- [ ] `e2e-web` installs Playwright browsers, boots api + web, executes `pnpm --filter web exec playwright test`.
- [ ] `coverage-report` aggregates api + web coverage, uploads as an artifact.
- [ ] `export-usage-check` runs `node scripts/audit-library-exports.mjs` (from Phase 20) and fails the build if any library export is unused.
- [ ] Workflow is green on a trivial README-only PR.

### Files to create / modify
- `.github/workflows/ci.yml` — new.
- `docker-compose.test.yml` — confirm CI compatibility (profiles, host networking).

### Agent Execution Prompt

> Role: DevOps engineer with GitHub Actions + pnpm workspace experience.
>
> Context: `docs/DEVELOPMENT_PLAN.md` §19 (first bullet). Job names are contractual — Phase 20's audit script and the branch-protection rules reference them by name.
>
> Objective: Deliver a reliable, reproducible CI pipeline that fails fast on lint/typecheck and comprehensively on tests + export coverage.
>
> Steps:
> 1. `install` job: checkout, install pnpm 10, `actions/setup-node@v4` with `cache: 'pnpm'`, run `pnpm install --frozen-lockfile`.
> 2. `lint` / `typecheck` / `unit` jobs: `needs: install`, reuse the pnpm cache, run `pnpm lint`, `pnpm typecheck`, `pnpm test`.
> 3. `e2e-api`: declare `services:` (postgres, redis); set `DATABASE_URL_TEST` and `REDIS_URL`; run `pnpm --filter api prisma migrate deploy` then `pnpm --filter api test:e2e`. Upload JUnit XML artifact.
> 4. `e2e-web`: `needs: e2e-api`; install Playwright browsers (`pnpm --filter web exec playwright install --with-deps chromium`); boot api + web with background processes; run `pnpm --filter web exec playwright test`. Upload traces on failure.
> 5. `coverage-report`: `needs: [unit, e2e-api, e2e-web]`; merge `coverage/` outputs; upload as artifact; optionally post summary via `actions/github-script`.
> 6. `export-usage-check`: `needs: install`; run `node scripts/audit-library-exports.mjs`; exit code drives build result.
> 7. Add `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }` to avoid duplicate runs.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Job names MUST be exactly: `install`, `lint`, `typecheck`, `unit`, `e2e-api`, `e2e-web`, `coverage-report`, `export-usage-check`.
> - Never print secrets; never hardcode secrets — use `secrets.GITHUB_TOKEN` only where needed.
> - Prefer `pnpm --filter` over `cd apps/...`.
>
> Verification:
> - `actionlint .github/workflows/ci.yml` — expected: no errors.
> - Open a trivial PR — expected: all 8 jobs pass in the named order.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P19-1 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P19-2 — `.github/workflows/release.yml` — tag-driven release

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P19-1`, `P19-3`, `P19-4`

### Description
On push of a tag matching `v*`, build production Docker images for `apps/api` and `apps/web`, push them to GHCR, and append a new row to `docs/RELEASES.md` via a bot commit.

### Acceptance Criteria
- [ ] `.github/workflows/release.yml` exists.
- [ ] Trigger: `on: push: tags: ['v*']`.
- [ ] Job `build-and-push` uses `docker/build-push-action@v6` for both api and web Dockerfiles.
- [ ] Images pushed to GHCR as `ghcr.io/<owner>/nest-auth-example-api:${{ github.ref_name }}` and `...-web:${{ github.ref_name }}`.
- [ ] `latest` tag pushed only when the ref is the highest semver on `main`.
- [ ] Follow-up job `update-releases-doc` performs a bot commit on `main` appending `| ${{ github.ref_name }} | @bymax-one/nest-auth@<version> | YYYY-MM-DD | ... |` to `docs/RELEASES.md`.
- [ ] Uses `permissions: contents: write, packages: write, id-token: write` (for GHCR + commit).
- [ ] Never pushes over a tag's existing image (idempotency guard).

### Files to create / modify
- `.github/workflows/release.yml` — new.
- `docs/RELEASES.md` — ensure append-only table shape.

### Agent Execution Prompt

> Role: Release engineer automating Docker + docs publication on tag.
>
> Context: `docs/DEVELOPMENT_PLAN.md` §19 (second bullet). Dockerfiles land in P19-3/P19-4; releases doc from P18-10.
>
> Objective: A `git tag v1.2.3 && git push --tags` publishes both images and records the release.
>
> Steps:
> 1. Job `build-and-push`:
>    - Checkout, login to GHCR via `docker/login-action@v3`.
>    - `docker/metadata-action@v5` per image to compute tags + labels.
>    - `docker/build-push-action@v6` for `apps/api/Dockerfile` and `apps/web/Dockerfile`.
> 2. Job `update-releases-doc`:
>    - `needs: build-and-push`.
>    - Checkout `main`, read library version from `pnpm list --filter api --json @bymax-one/nest-auth` (or `apps/api/package.json`).
>    - Append row to `docs/RELEASES.md`.
>    - Commit with `github-actions[bot]` author and push.
> 3. Guard idempotency: if `ghcr.io/<owner>/nest-auth-example-api:<tag>` already exists, skip and log.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Tag matching: only `v*` (strict).
> - Never `--force` push.
>
> Verification:
> - `actionlint .github/workflows/release.yml` — expected: no errors.
> - Dry-run by pushing `v0.0.0-test` on a branch — expected: both images appear in GHCR, `docs/RELEASES.md` row appended.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P19-2 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P19-3 — `apps/api/Dockerfile` — multi-stage production image

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `Phase 7`

### Description
Multi-stage Dockerfile for the NestJS api. Uses `pnpm deploy` to produce a slim runtime, runs as a non-root user, sets `NODE_ENV=production`, exposes `$API_PORT`, and runs `prisma migrate deploy` on container start (or via a separate entrypoint documented in DEPLOYMENT.md).

### Acceptance Criteria
- [ ] `apps/api/Dockerfile` exists.
- [ ] Stages: `deps` (installs with `pnpm install --frozen-lockfile`), `build` (runs `pnpm --filter api build` and `pnpm --filter api prisma generate`), `deploy` (runs `pnpm --filter api deploy /prod/api --prod`), `runtime` (copies `/prod/api`).
- [ ] Base image is `node:24-alpine` (or `node:24-slim` if Alpine breaks Prisma engines).
- [ ] Runs as a non-root user (`USER node`); container starts with `CMD ["node", "dist/main.js"]`.
- [ ] `ENV NODE_ENV=production`.
- [ ] Healthcheck: `HEALTHCHECK CMD wget -qO- http://localhost:${API_PORT}/api/health || exit 1`.
- [ ] `.dockerignore` excludes `node_modules`, `**/dist`, `**/*.env*`, `**/test`, `**/coverage`.
- [ ] Image builds and starts: `docker build -f apps/api/Dockerfile -t nest-auth-example-api . && docker run --rm -p 4000:4000 nest-auth-example-api` boots without crash.

### Files to create / modify
- `apps/api/Dockerfile` — new.
- `.dockerignore` — new or updated.
- `apps/api/docker-entrypoint.sh` — optional, runs `prisma migrate deploy` then `node dist/main.js`.

### Agent Execution Prompt

> Role: Container engineer building production images for a NestJS + Prisma service.
>
> Context: `docs/DEVELOPMENT_PLAN.md` §19 (api Dockerfile bullet).
>
> Objective: Produce a small, non-root, production-ready image that the release workflow can push.
>
> Steps:
> 1. Write a `deps` stage that copies the workspace (`pnpm-workspace.yaml`, root `package.json`, `apps/api/package.json`, lockfile) and runs `pnpm install --frozen-lockfile --ignore-scripts`.
> 2. `build` stage: copy source, run `pnpm --filter api prisma generate`, `pnpm --filter api build`.
> 3. `deploy` stage: `pnpm --filter api deploy --prod /prod/api` to produce a self-contained tree.
> 4. `runtime` stage: `FROM node:24-alpine AS runtime`, `COPY --from=deploy /prod/api /app`, `WORKDIR /app`, `USER node`, `CMD ["node", "dist/main.js"]`.
> 5. Add healthcheck + `EXPOSE`.
> 6. Ensure Prisma engines ship inside the deployed tree (`prisma/schema.prisma` + `node_modules/.prisma/client`).
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - `NODE_ENV=production` in the runtime stage.
> - Non-root (`USER node`) — never run as root.
> - No dev dependencies in the runtime layer.
>
> Verification:
> - `docker build -f apps/api/Dockerfile -t nest-auth-example-api .` — expected: builds.
> - `docker run --rm -e DATABASE_URL=... -e REDIS_URL=... -e JWT_SECRET=... -p 4000:4000 nest-auth-example-api` — expected: starts, `/api/health` returns 200.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P19-3 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P19-4 — `apps/web/Dockerfile` — multi-stage production image

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `Phase 14`

### Description
Multi-stage Dockerfile for the Next.js 16 web app. Uses Next.js standalone output for a minimal runtime, runs as a non-root user, sets `NODE_ENV=production`, and exposes `$WEB_PORT`.

### Acceptance Criteria
- [ ] `apps/web/Dockerfile` exists.
- [ ] Stages: `deps` (pnpm install), `build` (runs `pnpm --filter web build` with `output: 'standalone'` configured in `next.config.mjs`), `runtime` (copies `.next/standalone`, `.next/static`, `public`).
- [ ] Base image `node:24-alpine`.
- [ ] Runs as a non-root user (`USER nextjs`, uid:gid 1001:1001).
- [ ] `ENV NODE_ENV=production`; `EXPOSE 3000` (or `$WEB_PORT`).
- [ ] `CMD ["node", "server.js"]` (standalone entry).
- [ ] `next.config.mjs` sets `output: 'standalone'`.
- [ ] Healthcheck: `HEALTHCHECK CMD wget -qO- http://localhost:3000/api/health || exit 1` (if a web health route exists; otherwise hit `/`).
- [ ] Image builds and starts locally.

### Files to create / modify
- `apps/web/Dockerfile` — new.
- `apps/web/next.config.mjs` — ensure `output: 'standalone'`.
- `.dockerignore` — ensure `apps/web/.next`, `apps/web/node_modules` ignored.

### Agent Execution Prompt

> Role: Container engineer building production images for Next.js App Router.
>
> Context: `docs/DEVELOPMENT_PLAN.md` §19 (web Dockerfile bullet). Standalone output keeps the runtime tiny.
>
> Objective: Produce a minimal, non-root, production image for the web app.
>
> Steps:
> 1. `deps` stage: copy workspace manifests + lockfile, `pnpm install --frozen-lockfile --ignore-scripts`.
> 2. `build` stage: copy source, run `pnpm --filter web build`. Confirm `.next/standalone` is produced.
> 3. `runtime` stage: `FROM node:24-alpine`, add a non-root user, copy `.next/standalone`, `.next/static`, `public` from the build stage. Set `CMD ["node", "server.js"]`.
> 4. Ensure public envs (`NEXT_PUBLIC_*`) are baked at build time; private envs (`INTERNAL_API_URL`, `AUTH_JWT_SECRET_FOR_PROXY`) are read at runtime.
> 5. Add healthcheck + `EXPOSE`.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - `NODE_ENV=production`.
> - Non-root.
> - No dev dependencies in runtime.
>
> Verification:
> - `docker build -f apps/web/Dockerfile -t nest-auth-example-web .` — expected: builds.
> - `docker run --rm -e INTERNAL_API_URL=http://host.docker.internal:4000 -e AUTH_JWT_SECRET_FOR_PROXY=... -p 3000:3000 nest-auth-example-web` — expected: starts, `/` renders.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P19-4 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P19-5 — `docker-compose.prod.yml` + Renovate config

- **Status:** 🔴 Not Started
- **Priority:** Medium
- **Size:** S
- **Depends on:** `P19-3`, `P19-4`

### Description
Optional production-topology compose file for local smoke tests, plus a Renovate (or Dependabot) config that tracks `@bymax-one/nest-auth` once it ships to npm.

### Acceptance Criteria
- [ ] `docker-compose.prod.yml` exists and references the images built by P19-3 and P19-4 (`ghcr.io/<owner>/nest-auth-example-api:latest`, `...-web:latest`).
- [ ] Includes postgres, redis, api, web services; no Mailpit in prod profile.
- [ ] Env vars referenced from a `.env.prod.example` at the repo root (documented in DEPLOYMENT.md).
- [ ] `renovate.json` (preferred) or `.github/dependabot.yml` exists and watches the npm package `@bymax-one/nest-auth` with `rangeStrategy: 'pin'` and separate PRs per major.
- [ ] Renovate config groups Dockerfile base-image updates and GitHub Actions updates.
- [ ] README snippet (or DEPLOYMENT.md cross-link) shows `docker compose -f docker-compose.prod.yml up` smoke-test flow.

### Files to create / modify
- `docker-compose.prod.yml` — new.
- `.env.prod.example` — new.
- `renovate.json` — new (preferred). Alternatively `.github/dependabot.yml`.

### Agent Execution Prompt

> Role: Platform engineer configuring prod-parity local smoke tests + dependency automation.
>
> Context: `docs/DEVELOPMENT_PLAN.md` §19 (final two bullets).
>
> Objective: Enable `docker compose -f docker-compose.prod.yml up` to reproduce prod topology, and auto-raise PRs as `@bymax-one/nest-auth` publishes new versions.
>
> Steps:
> 1. Build `docker-compose.prod.yml` with four services: `postgres:18`, `redis:7`, `api` (image from P19-3), `web` (image from P19-4). Use healthchecks for postgres/redis and `depends_on: { service: { condition: service_healthy } }`.
> 2. Move all secrets to `${VAR}` references; ship a `.env.prod.example` at the repo root.
> 3. Author `renovate.json` with:
>    - `"extends": ["config:base"]`
>    - `"packageRules"`: pin `@bymax-one/nest-auth` (one PR per major), group Docker base-image updates, group GitHub Actions updates.
>    - `"schedule": ["every weekend"]`.
> 4. Add a Renovate dashboard issue via the `dependencyDashboard: true` option.
> 5. Document the smoke-test command in `docs/DEPLOYMENT.md`.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Never commit real `.env.prod`.
> - Compose file uses `version: '3.9'` syntax or Compose Spec (no `version:` key) — pick one consistently.
>
> Verification:
> - `docker compose -f docker-compose.prod.yml config` — expected: valid.
> - `renovate-config-validator renovate.json` — expected: no errors.
> - On a test PR, Renovate opens a PR for a mock `@bymax-one/nest-auth` bump — expected: within one scheduled run.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P19-5 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## Completion log
