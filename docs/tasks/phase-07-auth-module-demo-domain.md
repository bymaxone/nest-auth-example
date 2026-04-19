# Phase 7 — `BymaxAuthModule.registerAsync` + Guards/Decorators Demo Domain — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-7--bymaxauthmoduleregisterasync--guardsdecorators-demo-domain) §Phase 7
> **Total tasks:** 8
> **Progress:** 🔴 0 / 8 done (0%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID | Task | Status | Priority | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| P7-1 | `AuthModule` — `BymaxAuthModule.registerAsync` + `extraProviders` bindings | 🔴 | High | L | Phase 6 |
| P7-2 | `AppModule` — global guards, throttler, feature modules wiring | 🔴 | High | L | P7-1 |
| P7-3 | `TenantsModule` — `GET /api/tenants/me`, `POST /api/tenants` (OWNER-gated) | 🔴 | High | M | P7-2 |
| P7-4 | `ProjectsModule` — tenant-scoped CRUD + `SelfOrAdminGuard` | 🔴 | High | M | P7-2 |
| P7-5 | Debug endpoint `POST /api/debug/lockout` for brute-force demo | 🔴 | Medium | S | P7-2 |
| P7-6 | `UsersController` — `PATCH /api/users/:id/status` for status demo | 🔴 | High | M | P7-2 |
| P7-7 | `AuthExceptionFilter` — `AuthException` → shared error envelope | 🔴 | High | M | P7-1 |
| P7-8 | Smoke supertest — `register → verify → login → /me → logout → refresh` + projects listing | 🔴 | High | L | P7-3, P7-4, P7-7 |

---

## P7-1 — `AuthModule` — `BymaxAuthModule.registerAsync` + `extraProviders` bindings

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** L
- **Depends on:** Phase 6

### Description
Author `apps/api/src/auth/auth.module.ts` as the final wiring module for the library. Uses `BymaxAuthModule.registerAsync` with the Phase 6 factory (`buildAuthOptions`) and passes four bindings through `extraProviders`: `BYMAX_AUTH_USER_REPOSITORY`, `BYMAX_AUTH_PLATFORM_USER_REPOSITORY`, `BYMAX_AUTH_EMAIL_PROVIDER`, `BYMAX_AUTH_HOOKS`. The email provider class is chosen from `EMAIL_PROVIDER` env; `controllers.oauth` is computed synchronously from env presence on the `registerAsync` call. Covers FCM rows **#1–#5, #13–#20, #23, #29–#32** (module-level wiring layer).

### Acceptance Criteria
- [ ] `apps/api/src/auth/auth.module.ts` imports `BymaxAuthModule`, `BYMAX_AUTH_USER_REPOSITORY`, `BYMAX_AUTH_PLATFORM_USER_REPOSITORY`, `BYMAX_AUTH_EMAIL_PROVIDER`, `BYMAX_AUTH_HOOKS` from `@bymax-one/nest-auth` (runtime values).
- [ ] `BymaxAuthModule.registerAsync({ imports, useFactory, inject, controllers, extraProviders })` is the only dynamic module registration in the file.
- [ ] `useFactory: (config: ConfigService) => buildAuthOptions(config)`; `inject: [ConfigService]`; `imports: [ConfigModule, PrismaModule, RedisModule]`.
- [ ] `extraProviders` contains exactly four bindings:
  - `{ provide: BYMAX_AUTH_USER_REPOSITORY, useClass: PrismaUserRepository }`
  - `{ provide: BYMAX_AUTH_PLATFORM_USER_REPOSITORY, useClass: PrismaPlatformUserRepository }`
  - `{ provide: BYMAX_AUTH_EMAIL_PROVIDER, useClass: chooseEmailProviderClass() /* MailpitEmailProvider | ResendEmailProvider */ }`
  - `{ provide: BYMAX_AUTH_HOOKS, useClass: AppAuthHooks }`
- [ ] `controllers.mfa: true` is set explicitly on `registerAsync` (synchronous switch per interface doc).
- [ ] `controllers.oauth` is computed from env presence: `true` iff `OAUTH_GOOGLE_CLIENT_ID` and `OAUTH_GOOGLE_CLIENT_SECRET` are both set at process startup; otherwise omitted/false.
- [ ] `AuthModule` re-exports `BymaxAuthModule` so downstream feature modules can consume decorators/guards without re-importing the library directly.

### Files to create / modify
- `apps/api/src/auth/auth.module.ts` — new file.

### Agent Execution Prompt

> Role: Senior NestJS engineer familiar with `@bymax-one/nest-auth`.
>
> Context: Phase 7 wires the library into the host app. Covers FCM rows **#1–#5, #13–#20, #23, #29–#32** (module wiring layer). The library exports the four injection tokens from `@bymax-one/nest-auth` (see `../nest-auth/src/server/index.ts`). The options interface and its `AuthModuleAsyncOptions` live at `../nest-auth/src/server/interfaces/auth-module-options.interface.ts`.
>
> Objective: Produce `AuthModule` that calls `BymaxAuthModule.registerAsync` with the factory and bindings described above.
>
> Steps:
> 1. `import { BymaxAuthModule, BYMAX_AUTH_USER_REPOSITORY, BYMAX_AUTH_PLATFORM_USER_REPOSITORY, BYMAX_AUTH_EMAIL_PROVIDER, BYMAX_AUTH_HOOKS } from '@bymax-one/nest-auth'`.
> 2. Write a helper `chooseEmailProviderClass()` that returns `MailpitEmailProvider` by default and `ResendEmailProvider` iff `process.env.EMAIL_PROVIDER === 'resend'`.
> 3. Write a helper `isGoogleOAuthConfigured()` that returns `true` iff both Google client env vars are set at process startup.
> 4. Call `BymaxAuthModule.registerAsync({ imports: [ConfigModule, PrismaModule, RedisModule], useFactory: (c) => buildAuthOptions(c), inject: [ConfigService], controllers: { mfa: true, oauth: isGoogleOAuthConfigured() }, extraProviders: [...] })`.
> 5. Decorate the class with `@Module({ imports: [...], exports: [BymaxAuthModule] })`.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - The `controllers` field on `registerAsync` is synchronous — do NOT wrap in an async factory.
> - Import the four token constants as runtime values; import interface types as `type`.
>
> Verification:
> - `pnpm --filter api typecheck` — expected: green.
> - `pnpm --filter api dev`, then:
>   ```
>   curl -s -X POST http://localhost:4000/api/auth/register -H 'content-type: application/json' -H 'X-Tenant-Id: acme' -d '{"email":"t@example.com","password":"P@ssw0rd12345","name":"T"}'
>   ```
>   expected: `201` JSON response with a pending user; Mailpit receives a verification email.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P7-1 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P7-2 — `AppModule` — global guards, throttler, feature modules wiring

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** L
- **Depends on:** `P7-1`

### Description
Wire `AuthModule`, `ThrottlerModule.forRoot(AUTH_THROTTLE_CONFIGS)`, `TenantsModule`, and `ProjectsModule` into `AppModule`. Register the library's four global guards via `APP_GUARD` in the **exact order** `JwtAuthGuard → UserStatusGuard → MfaRequiredGuard → RolesGuard`. Covers FCM rows **#17 (throttling)**, **#18/#19 (RBAC + decorators)**, **#23 (status enforcement)** at the app-module layer.

### Acceptance Criteria
- [ ] `apps/api/src/app.module.ts` imports `AuthModule`, `ThrottlerModule.forRoot(AUTH_THROTTLE_CONFIGS)`, `TenantsModule`, `ProjectsModule`, plus the existing `HealthModule`/`PrismaModule`/`RedisModule`/`LoggerModule`/`ConfigModule`.
- [ ] `AUTH_THROTTLE_CONFIGS` is imported from `@bymax-one/nest-auth`.
- [ ] Four `APP_GUARD` providers registered in the `providers` array in exactly this order:
  1. `{ provide: APP_GUARD, useClass: JwtAuthGuard }`
  2. `{ provide: APP_GUARD, useClass: UserStatusGuard }`
  3. `{ provide: APP_GUARD, useClass: MfaRequiredGuard }`
  4. `{ provide: APP_GUARD, useClass: RolesGuard }`
- [ ] Guard imports come from `@bymax-one/nest-auth` (runtime values).
- [ ] `@Public()` bypass works: `/api/health` remains reachable unauthenticated.
- [ ] `UserStatusGuard` blocks the `blockedStatuses` configured in Phase 6 (`BANNED`, `INACTIVE`, `SUSPENDED`).
- [ ] `MfaRequiredGuard` honors `@SkipMfa()`.
- [ ] `RolesGuard` honors `@Roles(...)`.

### Files to create / modify
- `apps/api/src/app.module.ts` — extend existing module.

### Agent Execution Prompt

> Role: Senior NestJS engineer familiar with `@bymax-one/nest-auth` global-guard composition.
>
> Context: The library exposes `JwtAuthGuard`, `UserStatusGuard`, `MfaRequiredGuard`, `RolesGuard`, and `AUTH_THROTTLE_CONFIGS` via `@bymax-one/nest-auth` (see `../nest-auth/src/server/index.ts`). Covers FCM rows **#17, #18, #19, #23**.
>
> Objective: Register the four global guards in the exact documented order plus throttler/feature modules.
>
> Steps:
> 1. Import `AUTH_THROTTLE_CONFIGS`, `JwtAuthGuard`, `UserStatusGuard`, `MfaRequiredGuard`, `RolesGuard` from `@bymax-one/nest-auth`.
> 2. Add `ThrottlerModule.forRoot(AUTH_THROTTLE_CONFIGS)` to `imports`.
> 3. Add `AuthModule`, `TenantsModule`, `ProjectsModule` to `imports`.
> 4. Append four `APP_GUARD` providers to `providers` in the exact order specified.
> 5. Keep `HealthModule`, `PrismaModule`, `RedisModule`, `LoggerModule`, `ConfigModule` present.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Order of `APP_GUARD` providers matters — NestJS runs them in registration order. Do not swap.
> - Do not rename the four guards; they must match the library class names verbatim.
>
> Verification:
> - `pnpm --filter api typecheck` — expected: green.
> - `curl -s http://localhost:4000/api/health` — expected: `200` without auth (public).
> - `curl -i http://localhost:4000/api/projects` — expected: `401 UNAUTHORIZED` from `JwtAuthGuard`.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P7-2 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P7-3 — `TenantsModule` — `GET /api/tenants/me`, `POST /api/tenants` (OWNER-gated)

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P7-2`

### Description
Ship the example `TenantsModule` that exposes `GET /api/tenants/me` (lists tenants the current user belongs to) and `POST /api/tenants` (OWNER-gated tenant creation). Uses `@CurrentUser()` + `@Roles('OWNER')` end-to-end. Covers FCM rows **#19 (decorators)**, **#20 (multi-tenant isolation)**.

### Acceptance Criteria
- [ ] `apps/api/src/tenants/tenants.module.ts`, `tenants.controller.ts`, `tenants.service.ts` created.
- [ ] `GET /api/tenants/me` returns the list of tenants for the authenticated user (`@CurrentUser() user` used inside the handler).
- [ ] `POST /api/tenants` accepts `{ name, slug }`, gated by `@Roles('OWNER')`.
- [ ] Both routes require an authenticated JWT (global `JwtAuthGuard` applies; no `@Public()` decorator).
- [ ] Service uses `PrismaService` and scopes all reads/writes via the `tenantId` from `@CurrentUser()`.
- [ ] Controller imports `CurrentUser` and `Roles` from `@bymax-one/nest-auth`.

### Files to create / modify
- `apps/api/src/tenants/tenants.module.ts` — new file.
- `apps/api/src/tenants/tenants.controller.ts` — new file.
- `apps/api/src/tenants/tenants.service.ts` — new file.

### Agent Execution Prompt

> Role: Senior NestJS engineer familiar with `@bymax-one/nest-auth` decorators.
>
> Context: Demonstrates FCM rows **#19 (decorators)** and **#20 (multi-tenant isolation)**. `CurrentUser` and `Roles` are exported from `@bymax-one/nest-auth` (see `../nest-auth/src/server/index.ts`).
>
> Objective: Implement `TenantsModule` with the two documented routes.
>
> Steps:
> 1. `import { CurrentUser, Roles } from '@bymax-one/nest-auth'`.
> 2. `import type { AuthenticatedRequest } from '@bymax-one/nest-auth'` for typing the injected user.
> 3. Implement `GET /api/tenants/me` using `@CurrentUser() user` → `tenantsService.listForUser(user.id)`.
> 4. Implement `POST /api/tenants` with `@Roles('OWNER')` and DTO validation via `class-validator`.
> 5. Service queries `prisma.tenant` scoped to membership; never reads across tenants.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Import decorators as runtime values; import interfaces as `type`.
> - No manual `req.user` access — always through `@CurrentUser()`.
>
> Verification:
> - `pnpm --filter api typecheck` — expected: green.
> - With a valid access-token cookie for an OWNER:
>   ```
>   curl -s -b cookies.txt http://localhost:4000/api/tenants/me
>   ```
>   expected: `200` JSON array.
> - Same token for a MEMBER hitting `POST /api/tenants` — expected: `403 FORBIDDEN`.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P7-3 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P7-4 — `ProjectsModule` — tenant-scoped CRUD + `SelfOrAdminGuard`

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P7-2`

### Description
Ship the toy `ProjectsModule` that demonstrates tenant scoping end-to-end. `GET /api/projects` lists projects for `req.user.tenantId`. `POST /api/projects` requires `@Roles('ADMIN')`. `DELETE /api/projects/:id` is gated by `SelfOrAdminGuard` (owner of the project or any ADMIN). Covers FCM rows **#18 (RBAC)**, **#19 (decorators)**, **#20 (multi-tenant isolation)**.

### Acceptance Criteria
- [ ] `apps/api/src/projects/projects.module.ts`, `projects.controller.ts`, `projects.service.ts` created.
- [ ] `GET /api/projects` returns only rows where `tenantId === req.user.tenantId`.
- [ ] `POST /api/projects` uses `@Roles('ADMIN')`; body validated via `class-validator` DTO.
- [ ] `DELETE /api/projects/:id` uses `@UseGuards(SelfOrAdminGuard)` (library export).
- [ ] `SelfOrAdminGuard` imported from `@bymax-one/nest-auth`.
- [ ] Service enforces tenantId scoping on every query — no escape hatch.

### Files to create / modify
- `apps/api/src/projects/projects.module.ts` — new file.
- `apps/api/src/projects/projects.controller.ts` — new file.
- `apps/api/src/projects/projects.service.ts` — new file.
- `apps/api/src/projects/dto/create-project.dto.ts` — new file.

### Agent Execution Prompt

> Role: Senior NestJS engineer familiar with `@bymax-one/nest-auth` RBAC.
>
> Context: Demonstrates FCM rows **#18/#19/#20**. `Roles`, `CurrentUser`, `SelfOrAdminGuard` are exported from `@bymax-one/nest-auth`.
>
> Objective: Implement `ProjectsModule` with tenant-scoped listing, admin-gated creation, and self-or-admin deletion.
>
> Steps:
> 1. `import { CurrentUser, Roles, SelfOrAdminGuard } from '@bymax-one/nest-auth'`.
> 2. `import type { AuthenticatedRequest } from '@bymax-one/nest-auth'` for typing.
> 3. Controller methods receive `@CurrentUser() user` and pass `user.tenantId` to the service.
> 4. Service always includes `where: { tenantId: user.tenantId }` — never a bare `findMany`.
> 5. `DELETE /:id` decorated with `@UseGuards(SelfOrAdminGuard)`.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Import decorators/guards as runtime values; import interfaces as `type`.
> - Never bypass tenantId scoping — this is a reference implementation.
>
> Verification:
> - `pnpm --filter api typecheck` — expected: green.
> - With a MEMBER cookie: `GET /api/projects` returns `200` with their tenant's rows only.
> - With a MEMBER cookie: `POST /api/projects` returns `403`.
> - With an ADMIN cookie: `POST /api/projects` returns `201`.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P7-4 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P7-5 — Debug endpoint `POST /api/debug/lockout` for brute-force demo

- **Status:** 🔴 Not Started
- **Priority:** Medium
- **Size:** S
- **Depends on:** `P7-2`

### Description
Add a dev-only debug controller that hammers the library's `bf:` Redis counter for a given `(tenantId, email)` so the UI can deterministically demonstrate the lockout behavior configured in Phase 6 (`bruteForce.maxAttempts: 5`, `windowSeconds: 900`). Active only when `NODE_ENV !== 'production'`. Covers FCM row **#16 (brute-force protection)**.

### Acceptance Criteria
- [ ] `apps/api/src/debug/debug.module.ts` + `debug.controller.ts` created.
- [ ] Module is conditionally imported in `AppModule` only when `NODE_ENV !== 'production'`.
- [ ] `POST /api/debug/lockout` accepts `{ tenantId: string, email: string }` and increments the `nest-auth-example:bf:<hash>` key to `maxAttempts + 1` using `BYMAX_AUTH_REDIS_CLIENT`.
- [ ] Uses `sha256(tenantId + email)` (library export) to hash the key — matching the library's internal format.
- [ ] Controller is decorated with `@Public()` (from the library) to bypass `JwtAuthGuard` for easy demo use.
- [ ] Response is `{ locked: true, key: string }` so QA can inspect.

### Files to create / modify
- `apps/api/src/debug/debug.module.ts` — new file.
- `apps/api/src/debug/debug.controller.ts` — new file.
- `apps/api/src/app.module.ts` — conditionally add `DebugModule` to imports.

### Agent Execution Prompt

> Role: Senior NestJS engineer familiar with `@bymax-one/nest-auth` Redis namespacing.
>
> Context: FCM row **#16 (brute-force protection)**. The library key format is `<redisNamespace>:lf:<sha256(tenant+email)>` (per `OVERVIEW.md` §11) — this debug endpoint sets that counter to `maxAttempts + 1` so the next login attempt returns `ACCOUNT_LOCKED`. `sha256` and the redis token are exported from `@bymax-one/nest-auth`.
>
> Objective: Create a dev-only debug controller that forces brute-force lockout for demo purposes.
>
> Steps:
> 1. `import { Public, sha256, BYMAX_AUTH_REDIS_CLIENT } from '@bymax-one/nest-auth'`.
> 2. Inject the Redis client via `@Inject(BYMAX_AUTH_REDIS_CLIENT)`.
> 3. Compute `key = \`nest-auth-example:lf:${sha256(\`${tenantId}:${email.toLowerCase()}\`)}\``; then `SET key 6 EX 900`.
> 4. Guard the whole module with `if (process.env.NODE_ENV !== 'production')` in `AppModule`.
> 5. Mark the handler `@Public()` so global `JwtAuthGuard` lets it through.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Module MUST be absent in production — fail closed.
> - Do not expose any way to reset or unlock outside of normal library flows.
>
> Verification:
> - `pnpm --filter api typecheck` — expected: green.
> - `curl -s -X POST http://localhost:4000/api/debug/lockout -H 'content-type: application/json' -d '{"tenantId":"acme","email":"t@example.com"}'` — expected: `200 { locked: true, key: "..." }`.
> - Following login attempt for `t@example.com` returns `ACCOUNT_LOCKED` / `429`.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P7-5 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P7-6 — `UsersController` — `PATCH /api/users/:id/status` for status demo

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P7-2`

### Description
Ship `UsersController` exposing `PATCH /api/users/:id/status` gated by `@Roles('ADMIN')`. Updates user status via `PrismaUserRepository.updateStatus` so admins can demo the suspension flow end-to-end from the dashboard. Covers FCM row **#23 (account status enforcement)**.

### Acceptance Criteria
- [ ] `apps/api/src/users/users.module.ts` + `users.controller.ts` created.
- [ ] `PATCH /api/users/:id/status` accepts `{ status: 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'INACTIVE' | 'PENDING' }`.
- [ ] Handler decorated with `@Roles('ADMIN')` (library decorator).
- [ ] Handler delegates to `PrismaUserRepository.updateStatus(id, status)` — no direct Prisma calls.
- [ ] Enforces tenant scoping: admin may only update users inside their own `tenantId`.
- [ ] Emits an audit-log entry via `AppAuthHooks` (or an equivalent direct write) with event `user.status.changed` and `{ from, to }` payload.
- [ ] Returns the updated `SafeAuthUser` (no `passwordHash`, no `mfaSecret`).

### Files to create / modify
- `apps/api/src/users/users.module.ts` — new file.
- `apps/api/src/users/users.controller.ts` — new file.
- `apps/api/src/users/dto/update-status.dto.ts` — new file.

### Agent Execution Prompt

> Role: Senior NestJS engineer familiar with `@bymax-one/nest-auth`.
>
> Context: FCM row **#23 (account status enforcement)**. The global `UserStatusGuard` (registered in P7-2) checks cached user status against `blockedStatuses`; this endpoint lets an admin toggle that status so the guard has something to enforce.
>
> Objective: Add `PATCH /api/users/:id/status` gated by `@Roles('ADMIN')` that updates status through `PrismaUserRepository.updateStatus`.
>
> Steps:
> 1. `import { CurrentUser, Roles } from '@bymax-one/nest-auth'`.
> 2. Inject `PrismaUserRepository` and `AppAuthHooks`.
> 3. Validate `status` against the `UserStatus` enum via `class-validator`.
> 4. Verify the target user shares the admin's `tenantId`; throw `ForbiddenException` otherwise.
> 5. Call `repo.updateStatus(id, status)`; record the change via hooks.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Import decorators as runtime values; return `SafeAuthUser` only.
> - Never allow cross-tenant status changes from this endpoint.
>
> Verification:
> - `pnpm --filter api typecheck` — expected: green.
> - As an ADMIN: `curl -s -X PATCH http://localhost:4000/api/users/<uid>/status -b cookies.txt -H 'content-type: application/json' -d '{"status":"SUSPENDED"}'` — expected: `200`.
> - Next request by that suspended user returns `ACCOUNT_LOCKED` via `UserStatusGuard`.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P7-6 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P7-7 — `AuthExceptionFilter` — `AuthException` → shared error envelope

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P7-1`

### Description
Implement a global `ExceptionFilter` that maps every `AuthException` thrown by the library to a consistent JSON envelope `{ code, message, statusCode }` using `AUTH_ERROR_CODES`. Registered globally in `main.ts` so the frontend's error-map (`auth-errors.ts`, Phase 13) has a deterministic contract. Covers FCM row **#29 (shared error codes, anti-enumeration)**.

### Acceptance Criteria
- [ ] `apps/api/src/auth/auth-exception.filter.ts` exports `AuthExceptionFilter` implementing `ExceptionFilter` and decorated `@Catch(AuthException)`.
- [ ] Response shape: `{ code: AuthErrorCode, message: string, statusCode: number }`.
- [ ] `code` maps from `AUTH_ERROR_CODES`; `message` uses `AUTH_ERROR_MESSAGES[code]`.
- [ ] `statusCode` is HTTP status derived from the exception (defaulting to `400` where unspecified).
- [ ] Response body never leaks stack traces or internal errors.
- [ ] Filter registered globally in `apps/api/src/main.ts` via `app.useGlobalFilters(new AuthExceptionFilter())`.
- [ ] Imports use `import { AuthException, AUTH_ERROR_CODES, AUTH_ERROR_MESSAGES } from '@bymax-one/nest-auth'` (runtime) and `import type { AuthErrorCode } from '@bymax-one/nest-auth'`.

### Files to create / modify
- `apps/api/src/auth/auth-exception.filter.ts` — new file.
- `apps/api/src/main.ts` — register the global filter.

### Agent Execution Prompt

> Role: Senior NestJS engineer familiar with `@bymax-one/nest-auth` error surface.
>
> Context: FCM row **#29**. The library throws `AuthException` (runtime export) and exposes `AUTH_ERROR_CODES`, `AUTH_ERROR_MESSAGES`, and the `AuthErrorCode` type. The frontend's `lib/auth-errors.ts` (Phase 13) maps these codes to UI copy — that map relies on the API returning the same envelope for every failure.
>
> Objective: Map every `AuthException` to `{ code, message, statusCode }` using `AUTH_ERROR_CODES`, and register the filter globally.
>
> Steps:
> 1. `import { AuthException, AUTH_ERROR_CODES, AUTH_ERROR_MESSAGES } from '@bymax-one/nest-auth'`.
> 2. `import type { AuthErrorCode } from '@bymax-one/nest-auth'`.
> 3. `@Catch(AuthException)` — implement `catch(exception: AuthException, host: ArgumentsHost)`.
> 4. Extract `code`, `statusCode`, and `message` from the exception; default `message` via `AUTH_ERROR_MESSAGES[code]` when exception.message is missing.
> 5. Send the JSON envelope via the Express response.
> 6. Register in `main.ts`: `app.useGlobalFilters(new AuthExceptionFilter())`.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Do not catch generic `Error` here — only `AuthException`.
> - Never include stack traces, Prisma errors, or internal diagnostic text in the response body.
>
> Verification:
> - `pnpm --filter api typecheck` — expected: green.
> - `curl -s -X POST http://localhost:4000/api/auth/login -H 'content-type: application/json' -H 'X-Tenant-Id: acme' -d '{"email":"nobody@example.com","password":"wrong"}'` — expected: JSON `{ "code": "INVALID_CREDENTIALS", "message": "...", "statusCode": 401 }`.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P7-7 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P7-8 — Smoke supertest — `register → verify → login → /me → logout → refresh` + projects listing

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** L
- **Depends on:** `P7-3`, `P7-4`, `P7-7`

### Description
Write a single supertest e2e spec that exercises the core auth flow end-to-end: `POST /api/auth/register` → verify email OTP (via captured `IEmailProvider` calls or Mailpit API) → `POST /api/auth/login` → `GET /api/auth/me` → tenant-scoped `GET /api/projects` → `POST /api/auth/logout` → `POST /api/auth/refresh`. Serves as Phase 7's definition-of-done smoke; Phase 17 formalizes the full suite. Covers FCM rows **#1–#5, #13, #20, #29**.

### Acceptance Criteria
- [ ] `apps/api/test/auth-smoke.e2e-spec.ts` created and passes.
- [ ] Runs against `docker-compose.test.yml` (Postgres + Redis + Mailpit on alternate ports per Phase 1).
- [ ] Sets `X-Tenant-Id: acme` on every request.
- [ ] Register → 201 with pending user.
- [ ] Verify email OTP → 200 (pulls OTP via Mailpit polling helper `http://localhost:58025/api/v1/messages`).
- [ ] Login → 200 with `Set-Cookie` for `access_token`, `refresh_token`, `has_session`.
- [ ] `GET /api/auth/me` with access-token cookie → 200 with user payload.
- [ ] `GET /api/projects` with the same cookie → 200 with empty array (tenant scoped).
- [ ] `POST /api/auth/logout` → 204; subsequent `GET /api/auth/me` → 401.
- [ ] `POST /api/auth/refresh` with the stored refresh cookie → 200 with rotated tokens.
- [ ] Spec uses a fresh email + resets brute-force keys between runs.

### Files to create / modify
- `apps/api/test/auth-smoke.e2e-spec.ts` — new file.
- `apps/api/test/helpers/mailpit.ts` — (if not already present) poll helper for Mailpit test instance.

### Agent Execution Prompt

> Role: Senior NestJS engineer writing supertest e2e suites against a real Postgres + Redis + Mailpit stack.
>
> Context: Phase 7's definition-of-done. Covers FCM rows **#1 (register)**, **#2 (login)**, **#3 (JWT rotation)**, **#4 (revocation via logout)**, **#5 (email verification)**, **#13 (session list implied)**, **#20 (tenant-scoped listing)**, **#29 (error envelope path exercised)**. Uses supertest and the cookie jar to carry HttpOnly tokens through the flow.
>
> Objective: Implement the end-to-end smoke spec described above.
>
> Steps:
> 1. Bootstrap the Nest app via `Test.createTestingModule({ imports: [AppModule] })` with `DATABASE_URL_TEST`, `REDIS_URL` pointed at the alt-port services, and `SMTP_PORT=51025` / Mailpit UI `58025`.
> 2. Run `prisma migrate deploy` + truncate-table helper at `beforeAll`.
> 3. Use `supertest.agent(app.getHttpServer())` to persist cookies across requests.
> 4. Register with a unique email; poll Mailpit for the verification email; extract the OTP from the rendered template.
> 5. POST the OTP to `/api/auth/verify-email`, then POST credentials to `/api/auth/login`, then GET `/api/auth/me`.
> 6. GET `/api/projects`; assert `[]`.
> 7. POST `/api/auth/logout`; assert the next `/api/auth/me` is 401.
> 8. POST `/api/auth/refresh` using the stored refresh cookie; assert 200 and rotated tokens.
> 9. Import interfaces (`AuthenticatedRequest`, `AuthErrorCode`) as `type` when needed.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Do not mock the library or its guards — run the real stack.
> - Do not rely on a specific OTP format in assertions beyond "six digits"; extract from the email template.
>
> Verification:
> - `pnpm --filter api test:e2e -- auth-smoke.e2e-spec` — expected: green.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P7-8 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## Completion log
