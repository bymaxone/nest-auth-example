# Phase 4 — Prisma Schema, Migrations & Seed — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-4--prisma-schema-migrations--seed) §Phase 4
> **Total tasks:** 6
> **Progress:** 🔴 0 / 6 done (0%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID | Task | Status | Priority | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| P4-1 | Install & initialize Prisma (`prisma init`, wire `DATABASE_URL`) | 🔴 | High | S | Phase 3 |
| P4-2 | Model `Tenant` + `User` with `Role` / `UserStatus` enums | 🔴 | High | M | `P4-1` |
| P4-3 | Model `PlatformUser` + `PlatformRole` enum | 🔴 | High | S | `P4-2` |
| P4-4 | Model `Invitation`, `AuditLog`, `Project` with indexes | 🔴 | High | M | `P4-3` |
| P4-5 | Generate initial migration + write idempotent `seed.ts` | 🔴 | High | M | `P4-4` |
| P4-6 | Verification — `migrate dev -n init` + `db seed` on fresh stack | 🔴 | High | S | `P4-5` |

---

## P4-1 — Install & initialize Prisma (`prisma init`, wire `DATABASE_URL`)

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** S
- **Depends on:** Phase 3 (`apps/api` package manifest exists)

### Description
Initialize Prisma inside `apps/api`: run `prisma init`, create the `apps/api/prisma/` directory, configure the datasource to read from `DATABASE_URL`, and ensure the generated Prisma client points at the workspace's version of `@prisma/client`. Also confirm the `prisma:*` scripts introduced in Phase 3 run against the new directory.

### Acceptance Criteria
- [ ] `apps/api/prisma/schema.prisma` exists with a `datasource db { provider = "postgresql"; url = env("DATABASE_URL") }` block and a `generator client { provider = "prisma-client-js"; previewFeatures = [] }` block.
- [ ] `apps/api/.env.example` and the repo-root `.env.example` include `DATABASE_URL` with a docker-compose-compatible default (e.g., `postgresql://postgres:postgres@localhost:5432/example_app?schema=public`).
- [ ] `apps/api/prisma/seed.ts` file is scaffolded (empty `main()` is fine for now) and the `apps/api/package.json` `prisma` key declares `"seed": "tsx prisma/seed.ts"`.
- [ ] `pnpm --filter api prisma:generate` succeeds and produces `node_modules/.prisma/client`.

### Files to create / modify
- `apps/api/prisma/schema.prisma` — new file (datasource + generator only).
- `apps/api/prisma/seed.ts` — new placeholder.
- `apps/api/package.json` — add `"prisma": { "seed": "tsx prisma/seed.ts" }`.
- `.env.example` (root) + `apps/api/.env.example` — add `DATABASE_URL`.

### Agent Execution Prompt

> Role: Senior NestJS engineer wiring Prisma 6 into an ESM NestJS 11 workspace.
>
> Context: Phase 4 introduces the persistence layer. `apps/api` was bootstrapped in Phase 3; Postgres runs in Docker (Phase 1). Prisma must target the workspace `@prisma/client@^6` that Phase 3 installed.
>
> Objective: Initialize Prisma in `apps/api` with a clean `schema.prisma` skeleton, a seed script entry point, and an environment variable contract.
>
> Steps:
> 1. From `apps/api`, run `pnpm exec prisma init` (or author the files manually). Move the generated `prisma/` dir under `apps/api/prisma`.
> 2. Keep only the `datasource db` and `generator client` blocks in `schema.prisma` for this task.
> 3. Add `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/example_app?schema=public` to both the repo-root `.env.example` and `apps/api/.env.example`.
> 4. Create `apps/api/prisma/seed.ts` with a trivial `async function main() {}` + `main().finally(() => prisma.$disconnect())` skeleton.
> 5. Add the `"prisma": { "seed": "tsx prisma/seed.ts" }` block to `apps/api/package.json`.
> 6. Run `pnpm --filter api prisma:generate` to confirm it completes.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (ESM, pnpm 10, Node 24, strict TS).
> - Do not add tables yet — `P4-2` onwards owns schema modeling.
> - Do not commit real secrets in `.env.example`; the default password is documentation only.
>
> Verification:
> - `pnpm --filter api prisma:generate` — expected: exit 0, emits `@prisma/client` to `node_modules/.prisma/client`.
> - `pnpm --filter api typecheck` — expected: green.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P4-1 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P4-2 — Model `Tenant` + `User` with `Role` / `UserStatus` enums

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P4-1`

### Description
Model the two central tables required for multi-tenant auth: `Tenant` (owned by this example app) and `User` (mirrors the library's `AuthUser` contract). Declare the `Role` enum with `OWNER | ADMIN | MEMBER | VIEWER` and the `UserStatus` enum with `ACTIVE | PENDING | SUSPENDED | BANNED | INACTIVE` — these values are consumed verbatim by `@bymax-one/nest-auth`'s `roles.hierarchy` and `blockedStatuses` options.

### Acceptance Criteria
- [ ] `Role` enum is declared as `enum Role { OWNER ADMIN MEMBER VIEWER }`.
- [ ] `UserStatus` enum is declared as `enum UserStatus { ACTIVE PENDING SUSPENDED BANNED INACTIVE }`.
- [ ] `Tenant` model: `id @id @default(cuid())`, `name String`, `slug String @unique`, `domain String? @unique`, `createdAt`, `updatedAt`, relation `users User[]`.
- [ ] `User` model: `id @id @default(cuid())`, `tenantId` (FK → Tenant with `onDelete: Cascade`), `email`, `name`, `passwordHash String?`, `role Role @default(MEMBER)`, `status UserStatus @default(ACTIVE)`, `emailVerified Boolean @default(false)`, `mfaEnabled Boolean @default(false)`, `mfaSecret String?`, `mfaRecoveryCodes String[]`, `oauthProvider String?`, `oauthProviderId String?`, `lastLoginAt DateTime?`, `createdAt`, `updatedAt`.
- [ ] `@@unique([tenantId, email])` and a named unique constraint for `(oauthProvider, oauthProviderId)` (using `@@unique` with both fields); `@@index([tenantId])`.
- [ ] `pnpm --filter api prisma:generate` still succeeds.

### Files to create / modify
- `apps/api/prisma/schema.prisma` — add enums + `Tenant` + `User` models.

### Agent Execution Prompt

> Role: Senior Prisma schema designer familiar with multi-tenant SaaS data models.
>
> Context: `@bymax-one/nest-auth` expects specific field names and enum values on the user row (see `docs/OVERVIEW.md` §10). `Role` and `UserStatus` values are string-typed in the library and must match exactly — `OWNER | ADMIN | MEMBER | VIEWER` and `ACTIVE | PENDING | SUSPENDED | BANNED | INACTIVE`.
>
> Objective: Add the `Tenant` and `User` tables + their enums to `schema.prisma`.
>
> Steps:
> 1. Declare `enum Role { OWNER ADMIN MEMBER VIEWER }` and `enum UserStatus { ACTIVE PENDING SUSPENDED BANNED INACTIVE }` at the top of the schema.
> 2. Add `model Tenant { ... }` with fields + inverse relation to `User[]`.
> 3. Add `model User { ... }` using the field list in Acceptance Criteria. Mark the foreign key to Tenant with `@relation(fields: [tenantId], references: [id], onDelete: Cascade)`.
> 4. Add the unique constraints and `@@index([tenantId])`.
> 5. Re-run `prisma generate`.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (strict TS) and §Phase 4 for the field contract.
> - Enum casing MUST be exactly `OWNER | ADMIN | MEMBER | VIEWER` and `ACTIVE | PENDING | SUSPENDED | BANNED | INACTIVE` — the library compares against these strings.
> - Do NOT store anything the library hashes (e.g., `mfaSecret`, `mfaRecoveryCodes`) in any other representation than what the library returns.
>
> Verification:
> - `pnpm --filter api prisma:generate` — expected: exit 0.
> - `grep -q 'enum Role' apps/api/prisma/schema.prisma` — expected: match.
> - `pnpm --filter api typecheck` — expected: green.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P4-2 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P4-3 — Model `PlatformUser` + `PlatformRole` enum

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** S
- **Depends on:** `P4-2`

### Description
Model the `PlatformUser` table, which backs the platform admin context (Feature Coverage Matrix row #22). Declare the `PlatformRole` enum as `SUPER_ADMIN | SUPPORT`. Platform users are NOT tenant-scoped and have their own JWT context (`JwtPlatformGuard` in the library).

### Acceptance Criteria
- [ ] `enum PlatformRole { SUPER_ADMIN SUPPORT }` is declared.
- [ ] `PlatformUser` model has: `id @id @default(cuid())`, `email String @unique`, `name String`, `passwordHash String`, `role PlatformRole @default(SUPPORT)`, `status UserStatus @default(ACTIVE)` (reuses the enum from `P4-2`), `mfaEnabled Boolean @default(false)`, `mfaSecret String?`, `mfaRecoveryCodes String[]`, `platformId String?`, `lastLoginAt DateTime?`, `createdAt`, `updatedAt`.
- [ ] No `tenantId` field — platform users are tenantless by design.
- [ ] `pnpm --filter api prisma:generate` succeeds.

### Files to create / modify
- `apps/api/prisma/schema.prisma` — add `PlatformRole` enum + `PlatformUser` model.

### Agent Execution Prompt

> Role: Prisma schema designer modeling a privileged "operator" identity separate from tenant users.
>
> Context: `@bymax-one/nest-auth` supports a platform admin context (FCM #22). The library expects a `IPlatformUserRepository` implementation backed by a table that mirrors its `AuthPlatformUser` shape. See `docs/OVERVIEW.md` §10.
>
> Objective: Add the `PlatformUser` table and `PlatformRole` enum to `schema.prisma`.
>
> Steps:
> 1. Declare `enum PlatformRole { SUPER_ADMIN SUPPORT }`.
> 2. Add `model PlatformUser { ... }` with the field list in Acceptance Criteria; reuse the existing `UserStatus` enum.
> 3. Do NOT add a `tenantId` — platform users are global.
> 4. Re-run `prisma generate`.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 and §Phase 4.
> - Enum casing MUST be exactly `SUPER_ADMIN | SUPPORT`.
> - Never introduce a join between `PlatformUser` and `Tenant` — their contexts are intentionally isolated.
>
> Verification:
> - `pnpm --filter api prisma:generate` — expected: exit 0.
> - `grep -q 'enum PlatformRole' apps/api/prisma/schema.prisma` — expected: match.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P4-3 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P4-4 — Model `Invitation`, `AuditLog`, `Project` with indexes

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P4-3`

### Description
Add the remaining tables specified in `DEVELOPMENT_PLAN.md` §Phase 4: `Invitation` (for FCM #21), `AuditLog` (for the `IAuthHooks` writes in Phase 6), and `Project` (toy domain used by the RBAC demo in Phase 7). Include the exact index set so query plans match the documented access patterns.

### Acceptance Criteria
- [ ] `Invitation` model: `id @id @default(cuid())`, `tenantId` FK, `email String`, `role Role`, `token String @unique` (sha256 digest stored as hex), `invitedByUserId String`, `expiresAt DateTime`, `acceptedAt DateTime?`, `createdAt`. Index on `(tenantId, createdAt)`.
- [ ] `AuditLog` model: `id @id @default(cuid())`, `tenantId String?` (nullable — platform events are tenantless), `actorUserId String?`, `actorPlatformUserId String?`, `event String`, `payload Json`, `ip String?`, `userAgent String?`, `createdAt`. `@@index([tenantId, createdAt(sort: Desc)])` and `@@index([event, createdAt(sort: Desc)])`.
- [ ] `Project` model: `id @id @default(cuid())`, `tenantId` FK, `name String`, `ownerUserId String`, `createdAt`. `@@index([tenantId])`.
- [ ] `Tenant` model gains inverse relations for `invitations`, `auditLogs`, `projects`.
- [ ] `pnpm --filter api prisma:generate` still succeeds.

### Files to create / modify
- `apps/api/prisma/schema.prisma` — add three models + inverse relations + indexes.

### Agent Execution Prompt

> Role: Prisma schema designer adding auxiliary tables to a multi-tenant auth app.
>
> Context: These three tables round out the library's Phase-6+ needs: invitations (FCM #21), audit log (hooks), and a toy `Project` table used to demonstrate `@Roles` + `tenantId` scoping in Phase 7.
>
> Objective: Add `Invitation`, `AuditLog`, and `Project` to `schema.prisma` with the exact indexes required by DEVELOPMENT_PLAN §Phase 4.
>
> Steps:
> 1. Add `model Invitation` with the listed fields and `@@index([tenantId, createdAt])`.
> 2. Add `model AuditLog` — remember `tenantId` is nullable. Add both descending indexes: `([tenantId, createdAt(sort: Desc)])` and `([event, createdAt(sort: Desc)])`.
> 3. Add `model Project` with `@@index([tenantId])`.
> 4. Update the `Tenant` model to include inverse relations `invitations Invitation[]`, `auditLogs AuditLog[]`, `projects Project[]`.
> 5. Re-run `prisma generate`.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 and §Phase 4.
> - `token` on `Invitation` stores the SHA-256 hex digest — never the raw token.
> - `payload` on `AuditLog` must be `Json`, not text — Postgres jsonb is preferred.
>
> Verification:
> - `pnpm --filter api prisma:generate` — expected: exit 0.
> - `grep -c '@@index' apps/api/prisma/schema.prisma` — expected: at least 4 (two Users/Projects + two AuditLog).

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P4-4 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P4-5 — Generate initial migration + write idempotent `seed.ts`

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P4-4`

### Description
Create the initial migration (`prisma migrate dev -n init`) and fill in `seed.ts` with idempotent demo data: two tenants (`acme`, `globex`), one user per role (OWNER, ADMIN, MEMBER, VIEWER) per tenant, and one platform super-admin. Use `upsert` so reruns are harmless. Seed output documents the dev credentials (email + password) to stdout.

### Acceptance Criteria
- [ ] `apps/api/prisma/migrations/<timestamp>_init/migration.sql` exists and creates every table + index + enum from `P4-2`–`P4-4`.
- [ ] `apps/api/prisma/seed.ts`:
  - Creates tenants via `upsert` keyed on `slug`.
  - Creates users via `upsert` keyed on the `(tenantId, email)` unique constraint, one per role per tenant (8 users total).
  - Sets `emailVerified: true` and a deterministic `passwordHash` (produced via `bcrypt` with a known dev password).
  - Creates exactly one `PlatformUser` (`SUPER_ADMIN`) via `upsert` on `email`.
  - Prints the demo credentials to stdout in a clearly-marked `[dev-only]` block.
- [ ] Re-running `pnpm --filter api prisma:seed` twice in a row does not throw and does not create duplicate rows.
- [ ] `seed.ts` reads `DATABASE_URL` via `dotenv-safe` (consistent with the rest of the app).

### Files to create / modify
- `apps/api/prisma/migrations/<timestamp>_init/migration.sql` — auto-generated.
- `apps/api/prisma/seed.ts` — full implementation.

### Agent Execution Prompt

> Role: Senior NestJS engineer writing Prisma seed scripts for a reference SaaS app.
>
> Context: Phase 4 finishes by shipping a reproducible seeded dataset that every downstream phase (7+) depends on. Passwords MUST be hashed with `bcrypt` because that is what `@bymax-one/nest-auth` uses for `passwordHash` comparison.
>
> Objective: Generate the initial migration and author an idempotent seed script that creates two tenants, eight tenant users (one per role, per tenant), and one platform super-admin.
>
> Steps:
> 1. With Docker running (from Phase 1), run `pnpm --filter api prisma:migrate dev --name init` to generate the migration.
> 2. Implement `seed.ts`:
>    - Import `PrismaClient` and `bcrypt` (add `bcrypt` + `@types/bcrypt` to `apps/api/package.json` if missing).
>    - `const passwordHash = await bcrypt.hash('Passw0rd!Passw0rd', 12)`.
>    - `upsert` tenants by `slug: 'acme' | 'globex'`.
>    - For each tenant × each role (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`), `upsert` a user with email `<role>.<slug>@example.com`, `emailVerified: true`, `status: 'ACTIVE'`, the bcrypt hash above.
>    - `upsert` a `PlatformUser` with email `platform@example.com`, `role: 'SUPER_ADMIN'`.
>    - `console.log` a banner: `--- DEV CREDENTIALS (seed) --- <emails + shared password> --- remove in production ---`.
> 3. Ensure `main()` closes the Prisma client in a `finally` block.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (ESM, strict TS).
> - Seed MUST be idempotent — re-running produces identical state.
> - Never commit real production credentials.
> - Do NOT seed `Project`, `Invitation`, or `AuditLog` rows — those are created by tests and Phase 7 demos.
>
> Verification:
> - `pnpm --filter api prisma:migrate dev -n init` — expected: migration committed, Prisma client regenerates.
> - `pnpm --filter api prisma:seed` twice back-to-back — expected: both runs exit 0, `SELECT count(*) FROM "User"` stays at `8`, `PlatformUser` stays at `1`.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P4-5 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P4-6 — Verification — `migrate dev -n init` + `db seed` on fresh stack

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** S
- **Depends on:** `P4-5`

### Description
Run the Phase 4 "definition of done" against a freshly-booted Docker stack: `docker compose down -v && docker compose up -d` → `prisma migrate dev` → `prisma db seed`. Confirm the seeded row counts and that stdout contains the documented dev credentials banner so downstream consumers can read it.

### Acceptance Criteria
- [ ] `docker compose down -v && docker compose up -d postgres` succeeds from a clean state.
- [ ] `pnpm --filter api prisma:migrate dev -n init` applies without errors on the empty database.
- [ ] `pnpm --filter api prisma:seed` completes and prints the `--- DEV CREDENTIALS (seed) ---` banner to stdout.
- [ ] `psql $DATABASE_URL -c 'SELECT count(*) FROM "User"; SELECT count(*) FROM "PlatformUser"; SELECT count(*) FROM "Tenant";'` returns `8`, `1`, `2` respectively.
- [ ] `pnpm --filter api prisma:seed` run a second time (without wiping) still returns the same counts.

### Files to create / modify
- _None — this task only runs and verifies._

### Agent Execution Prompt

> Role: NestJS engineer gating Phase 4 completion against the documented "definition of done".
>
> Context: The migration + seed behavior must be reproducible from a clean Docker stack so contributors can onboard in minutes. This is the last gate before Phase 5 starts layering infra modules.
>
> Objective: Run the Phase 4 verification suite end-to-end on a fresh Postgres instance and confirm all row counts.
>
> Steps:
> 1. `docker compose down -v && docker compose up -d postgres` from the repo root.
> 2. `pnpm --filter api prisma:migrate dev -n init` — if the migration already exists, Prisma will detect and apply it.
> 3. `pnpm --filter api prisma:seed`.
> 4. Using `psql` (or `pnpm --filter api prisma:studio`), count rows in `Tenant` (2), `User` (8), `PlatformUser` (1).
> 5. Re-run `pnpm --filter api prisma:seed` and confirm counts stay the same (idempotency).
> 6. Capture the printed dev credentials banner into the task completion log one-liner.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 and §Phase 4 "Definition of done".
> - Do not skip the `docker compose down -v` — verifying against a lingering DB hides schema drift.
> - Do not modify `seed.ts` here — only run and verify.
>
> Verification:
> - `pnpm --filter api prisma:migrate dev -n init` — expected: exit 0.
> - `pnpm --filter api prisma:seed` — expected: exit 0, banner printed.
> - `psql $DATABASE_URL -c 'SELECT count(*) FROM "User";'` — expected: `8`.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P4-6 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## Completion log
