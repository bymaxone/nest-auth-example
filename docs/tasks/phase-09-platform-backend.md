# Phase 9 — Platform Admin Context (Backend) — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-9--platform-admin-context-backend) §Phase 9
> **Total tasks:** 4
> **Progress:** 🔴 0 / 4 done (0%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID | Task | Status | Priority | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| P9-1 | Confirm platform config + auto-mount of `/api/auth/platform/*` | 🔴 | High | S | Phase 7 |
| P9-2 | Build `platform.module.ts` endpoints + audit logging | 🔴 | High | M | P9-1 |
| P9-3 | Platform ↔ dashboard isolation e2e | 🔴 | High | M | P9-2 |
| P9-4 | Seed augmentation — guaranteed SUPER_ADMIN PlatformUser | 🔴 | Medium | S | Phase 4 |

---

## P9-1 — Confirm platform config + auto-mount of `/api/auth/platform/*`

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** S
- **Depends on:** Phase 7

### Description
Confirm that `auth.config.ts` sets `platform.enabled: true` and defines `roles.platformHierarchy` (both already defined in Phase 6), and verify that `@bymax-one/nest-auth` auto-mounts the platform auth routes under `/api/auth/platform/*`. Covers FCM row **#22 (Platform admin context)**.

### Acceptance Criteria
- [ ] `auth.config.ts` explicitly returns `platform: { enabled: true }` and `roles.platformHierarchy: { SUPER_ADMIN: ['SUPPORT'], SUPPORT: [] }` with an inline comment citing FCM #22.
- [ ] Booting the API exposes `POST /api/auth/platform/login`, `POST /api/auth/platform/logout`, and `GET /api/auth/platform/me` — verified via curl or an automated route dump.
- [ ] `controllers.platform: true` is resolved in `AuthModule` (either implicitly via `platform.enabled` or explicitly — whichever the library requires).
- [ ] No changes to repositories or hooks needed (they already support the platform context from Phase 6).

### Files to create / modify
- `apps/api/src/auth/auth.config.ts` — confirm + comment.
- `apps/api/src/auth/auth.module.ts` — ensure `controllers.platform: true` if required.

### Agent Execution Prompt

> Role: NestJS engineer familiar with `@bymax-one/nest-auth`'s platform admin context.
>
> Context: FCM row #22. Platform routes bypass `tenantIdResolver` — no `X-Tenant-Id` header required — and use their own JWT payload shape (`PlatformJwtPayload`).
>
> Objective: Confirm the platform context is active and its auth routes are reachable.
>
> Steps:
> 1. Review `auth.config.ts`; ensure `platform: { enabled: true }` and the platform hierarchy are present. Add comment `// FCM #22 — Platform admin context`.
> 2. Boot `pnpm --filter api dev`.
> 3. Run `curl -i -X POST http://localhost:4000/api/auth/platform/login -H 'content-type: application/json' -d '{}'` — expect a 400 (validation error), not 404.
> 4. If the route returns 404, flip `controllers.platform: true` explicitly in `auth.module.ts`.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Platform routes bypass `tenantIdResolver` (no `X-Tenant-Id` header required) — do not add one to test calls.
> - Do not hand-mount any route yourself; the library is responsible.
>
> Verification:
> - `curl -i -X POST http://localhost:4000/api/auth/platform/login` — expected: not `404`.
> - `pnpm --filter api typecheck` — expected: green.

### Completion Protocol

1. ✅ Set Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P9-1 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P9-2 — Build `platform.module.ts` endpoints + audit logging

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P9-1`

### Description
Create `apps/api/src/platform/platform.module.ts` with three host-owned endpoints that demonstrate the platform context: list tenants, list users in a tenant, and mutate a user's status. Every mutation writes an `AuditLog` entry. Covers FCM row **#22**.

### Acceptance Criteria
- [ ] `apps/api/src/platform/platform.module.ts` exists and is imported by `app.module.ts`.
- [ ] `PlatformController` at `/api/platform` with routes:
  - `GET /tenants` — guarded by `JwtPlatformGuard` and `PlatformRolesGuard` with `@PlatformRoles('SUPER_ADMIN', 'SUPPORT')`. Returns all tenants.
  - `GET /users?tenantId=...` — same guards. Returns users for the given tenant.
  - `PATCH /users/:id/status` — same guards. Body: `{ status: UserStatus }`. Writes an `AuditLog` row with `event: 'platform.user.status_changed'`, a payload including `{ targetUserId, previousStatus, newStatus }`, and `actorPlatformUserId: ctx.platformUser.id`.
- [ ] Guards, decorators, and types are imported only from `@bymax-one/nest-auth` (no guard re-implementation).
- [ ] Every mutation appends an `AuditLog` row via the Prisma client.
- [ ] Query validation uses `class-validator` DTOs (matches the rest of the project).

### Files to create / modify
- `apps/api/src/platform/platform.module.ts` — new module.
- `apps/api/src/platform/platform.controller.ts` — new controller.
- `apps/api/src/platform/platform.service.ts` — new service; calls `PrismaService` directly.
- `apps/api/src/platform/dto/list-users.dto.ts`, `dto/update-status.dto.ts` — new DTOs.
- `apps/api/src/app.module.ts` — import `PlatformModule`.

### Agent Execution Prompt

> Role: NestJS engineer familiar with `@bymax-one/nest-auth`'s platform guards (`JwtPlatformGuard`, `PlatformRolesGuard`) and the host project's Prisma + audit-log conventions.
>
> Context: FCM row #22. The library already ships the auth side (`/api/auth/platform/*`); this task adds example host-owned endpoints under `/api/platform/*` that demonstrate how a consumer builds on top of the platform context.
>
> Objective: Build `PlatformModule` with list-tenants, list-users, and update-status endpoints, all audited.
>
> Steps:
> 1. Create `PlatformModule` importing `PrismaModule`. Register `PlatformController` and `PlatformService`.
> 2. On `PlatformController`, apply `@UseGuards(JwtPlatformGuard, PlatformRolesGuard)` at the class level and `@PlatformRoles('SUPER_ADMIN', 'SUPPORT')` per route (or class-level where identical).
> 3. Implement `GET /tenants` → `prisma.tenant.findMany()`.
> 4. Implement `GET /users?tenantId=...` → validate `tenantId` via DTO → `prisma.user.findMany({ where: { tenantId } })`. Strip `passwordHash`, `mfaSecret`, `mfaRecoveryCodes` from the response.
> 5. Implement `PATCH /users/:id/status` with a body DTO using `@IsEnum(UserStatus)`. Read previous status, call `prisma.user.update`, then `prisma.auditLog.create` with the event payload. Use `@CurrentUser()` (the library returns `PlatformAuthenticatedRequest.user` here) for `actorPlatformUserId`.
> 6. Import `PlatformModule` into `app.module.ts`.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (ESM, strict TS).
> - Import guards exactly as `JwtPlatformGuard`, `PlatformRolesGuard` from `@bymax-one/nest-auth` (confirmed in the library's `src/server/index.ts`).
> - Platform routes bypass `tenantIdResolver` — do not require `X-Tenant-Id`.
> - Never leak `passwordHash` / `mfaSecret` / `mfaRecoveryCodes` in responses.
>
> Verification:
> - `pnpm --filter api typecheck` — expected: green.
> - After seeding (P9-4), `curl -b cookies.txt http://localhost:4000/api/platform/tenants` after platform login — expected: `200` with a JSON array.
> - `curl` without a platform cookie — expected: `401`.

### Completion Protocol

1. ✅ Set Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P9-2 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P9-3 — Platform ↔ dashboard isolation e2e

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P9-2`, `P9-4`

### Description
Write a supertest e2e spec that asserts the critical isolation property: a platform JWT (`role: 'SUPER_ADMIN'` / `'SUPPORT'`) must be rejected by the dashboard's `JwtAuthGuard` — e.g., on `GET /api/projects`. Likewise, a dashboard JWT must be rejected on `/api/platform/tenants`. Covers FCM row **#22**.

### Acceptance Criteria
- [ ] `apps/api/test/platform-isolation.e2e-spec.ts` created.
- [ ] Test logs in via `POST /api/auth/platform/login` using the seeded `SUPER_ADMIN` and extracts its `access_token` cookie.
- [ ] With only the platform cookie, `GET /api/projects` returns `401` or `403` (not `200`).
- [ ] Test logs in a dashboard user via `POST /api/auth/login`; with only that cookie, `GET /api/platform/tenants` returns `401` or `403`.
- [ ] Test also verifies `GET /api/platform/tenants` **with** the platform cookie returns `200` (positive case).
- [ ] Cookies from the two contexts do not overlap (assert different cookie names or scopes — whichever the library exposes).

### Files to create / modify
- `apps/api/test/platform-isolation.e2e-spec.ts` — new spec.

### Agent Execution Prompt

> Role: NestJS engineer writing supertest e2e specs covering cross-context security.
>
> Context: FCM row #22 — if a platform token ever passes `JwtAuthGuard`, it is a cross-context privilege leak. This spec is the guard.
>
> Objective: Prove tokens from one context cannot access the other.
>
> Steps:
> 1. Bring up Postgres, Redis, Mailpit via `docker-compose.test.yml`.
> 2. Seed via `pnpm --filter api prisma:seed` so the `SUPER_ADMIN` platform user exists (see P9-4 for the credentials).
> 3. In the spec: `POST /api/auth/platform/login` with the super-admin creds → capture the `Set-Cookie` header.
> 4. Use supertest `agent` with only the platform cookie; hit `GET /api/projects` with `X-Tenant-Id: <seed-tenant-id>`; assert status `401` or `403`.
> 5. `POST /api/auth/login` with a dashboard user; capture the cookie. Hit `GET /api/platform/tenants`; assert `401` or `403`.
> 6. Positive sanity check: platform cookie → `GET /api/platform/tenants` → 200. Dashboard cookie → `GET /api/projects` (with `X-Tenant-Id`) → 200.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Platform routes bypass `tenantIdResolver` — do not send `X-Tenant-Id` to `/api/platform/*`.
> - Use `supertest.agent` so cookies carry between calls within a single context.
>
> Verification:
> - `pnpm --filter api test:e2e -- platform-isolation` — expected: green.
> - Temporarily weaken a guard → expected: this spec fails, proving it is effective.

### Completion Protocol

1. ✅ Set Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P9-3 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P9-4 — Seed augmentation — guaranteed SUPER_ADMIN PlatformUser

- **Status:** 🔴 Not Started
- **Priority:** Medium
- **Size:** S
- **Depends on:** Phase 4 (seed scaffold already exists)

### Description
Extend `apps/api/prisma/seed.ts` to idempotently upsert exactly one `SUPER_ADMIN` `PlatformUser` with a known dev password. Document the credentials in this task prompt so every downstream platform test and frontend task has a reliable login. Covers FCM row **#22**.

### Acceptance Criteria
- [ ] `prisma/seed.ts` upserts a `PlatformUser` with: `email: 'platform@example.dev'`, `name: 'Platform Admin'`, `role: 'SUPER_ADMIN'`, `status: 'ACTIVE'`, `emailVerified: true`, `passwordHash` derived from `'PlatformPassw0rd!'` via the same hashing function the library uses (import the library's password utility or reuse the helper defined in Phase 6).
- [ ] Seed is idempotent (`upsert` by email).
- [ ] Credentials are documented in `docs/GETTING_STARTED.md` (stub or existing — add a "Platform admin (dev only)" table row).
- [ ] `pnpm --filter api prisma:seed` prints the platform user as part of the output.

### Files to create / modify
- `apps/api/prisma/seed.ts` — add platform user upsert.
- `docs/GETTING_STARTED.md` — add a "Seeded platform admin" block (dev only).

### Agent Execution Prompt

> Role: Backend engineer working with Prisma seed scripts and `@bymax-one/nest-auth`'s password hashing utility.
>
> Context: Every downstream platform test (P9-3 isolation, Phase 15 frontend, Phase 17 e2e) requires a known-good `SUPER_ADMIN` `PlatformUser`. This task guarantees one exists after `prisma:seed`.
>
> Objective: Idempotently seed a SUPER_ADMIN PlatformUser with documented dev credentials.
>
> Steps:
> 1. In `prisma/seed.ts`, import the project's password hashing helper (from the repository layer built in Phase 6 — it wraps the library's password utility).
> 2. Compute `passwordHash = await hash('PlatformPassw0rd!')`.
> 3. `prisma.platformUser.upsert({ where: { email: 'platform@example.dev' }, update: { status: 'ACTIVE' }, create: { email: 'platform@example.dev', name: 'Platform Admin', role: 'SUPER_ADMIN', status: 'ACTIVE', mfaEnabled: false, passwordHash } })`.
> 4. Print `Seeded platform admin: platform@example.dev / PlatformPassw0rd!` with a **dev-only** warning.
> 5. Add a block to `docs/GETTING_STARTED.md` under a "Seeded accounts" section documenting the credentials and an explicit warning they must never be used in production.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Use the same hashing helper as real registration — never bypass the library's password rules.
> - Idempotent: running seed twice must not throw or create duplicates.
>
> Verification:
> - `pnpm --filter api prisma:seed` — expected: prints `Seeded platform admin: platform@example.dev / PlatformPassw0rd!`.
> - Run it twice — expected: no errors, no duplicates.
> - `POST http://localhost:4000/api/auth/platform/login` with the creds — expected: `200` + cookies.

### Completion Protocol

1. ✅ Set Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P9-4 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## Completion log
