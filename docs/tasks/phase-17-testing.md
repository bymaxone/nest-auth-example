# Phase 17 — Testing (Unit, E2E, Playwright) — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-17--testing-unit-e2e-playwright) §Phase 17
> **Total tasks:** 10
> **Progress:** 🟢 10 / 10 done (100%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID     | Task                                                                   | Status | Priority | Size | Depends on          |
| ------ | ---------------------------------------------------------------------- | ------ | -------- | ---- | ------------------- |
| P17-1  | API unit tests — repositories, hooks, config                           | 🟢     | High     | M    | Phase 6             |
| P17-2  | API unit tests — email providers                                       | 🟢     | High     | M    | Phase 6             |
| P17-3  | API unit tests — domain modules (tenants/projects)                     | 🟢     | Medium   | M    | Phase 7             |
| P17-4  | API e2e — auth bundle 1 (register/verify/login/logout/refresh/revoke)  | 🟢     | High     | L    | P17-8               |
| P17-5  | API e2e — password / MFA / recovery codes                              | 🟢     | High     | L    | P17-8               |
| P17-6  | API e2e — sessions / brute-force / throttle                            | 🟢     | High     | L    | P17-8               |
| P17-7  | API e2e — RBAC / tenant / status / invitations / platform / ws / oauth | 🟢     | High     | L    | P17-8               |
| P17-8  | API e2e bootstrap (Jest setup, Mailpit poller, DB helpers)             | 🟢     | High     | M    | Phase 6             |
| P17-9  | Web unit tests (Vitest) — schemas, auth-errors, OtpInput               | 🟢     | High     | M    | Phase 13            |
| P17-10 | Web e2e (Playwright) — full user journeys + auth fixture               | 🟢     | High     | L    | P17-4, P17-5, P17-8 |

---

## P17-1 — API unit tests — repositories, hooks, config

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** M
- **Depends on:** `Phase 6`

### Description

Jest unit tests for the four library-facing adapters plus the zod config. Covers `PrismaUserRepository` (including null `passwordHash` for OAuth users and empty `mfaRecoveryCodes`), `PrismaPlatformUserRepository`, `AppAuthHooks` (asserts `AuditLog` rows with correct event slugs per hook), and `auth.config.ts` (rejects short `JWT_SECRET`, non-base64 `MFA_ENCRYPTION_KEY`). Backs FCM rows #30, #32 and Appendix B `IUserRepository`/`IPlatformUserRepository`/`IAuthHooks`.

### Acceptance Criteria

- [x] `apps/api/src/auth/prisma-user.repository.spec.ts` covers `findById`, `findByEmail`, `create`, `updatePassword`, `linkOAuth`, `updateMfa`, and the OAuth-null-password path.
- [x] `apps/api/src/auth/prisma-platform-user.repository.spec.ts` mirrors the above without `tenantId`.
- [x] `apps/api/src/auth/app-auth.hooks.spec.ts` asserts every `IAuthHooks` method writes an `AuditLog` row with the expected `event` slug and a sanitized payload (no secrets).
- [x] `apps/api/src/auth/auth.config.spec.ts` asserts zod rejects `JWT_SECRET` < 32 chars, non-base64 `MFA_ENCRYPTION_KEY`, missing `DATABASE_URL`, and accepts a complete valid env.
- [x] All tests mock Prisma via `jest-mock-extended` (`DeepMockProxy<PrismaClient>`) — no real DB.
- [x] Coverage for `apps/api/src/auth/` reaches ≥ 90%.

### Files to create / modify

- `apps/api/src/auth/prisma-user.repository.spec.ts` — new spec.
- `apps/api/src/auth/prisma-platform-user.repository.spec.ts` — new spec.
- `apps/api/src/auth/app-auth.hooks.spec.ts` — new spec.
- `apps/api/src/auth/auth.config.spec.ts` — new spec.
- `apps/api/jest.config.ts` — add coverage thresholds for `src/auth/**`.

### Agent Execution Prompt

> Role: Senior QA engineer with NestJS + Jest + Prisma mocking experience.
>
> Context: Covers `docs/DEVELOPMENT_PLAN.md` §17.1 (first five bullets). The adapters under test were built in Phase 6.
>
> Objective: Lock the library-facing adapters and zod config with fast, pure Jest unit tests.
>
> Steps:
>
> 1. Install `jest-mock-extended` as a dev dep in `apps/api` if not already present.
> 2. For each repository spec, build a `DeepMockProxy<PrismaClient>`, provide it under `PrismaService`, then exercise every public method. Include OAuth (null `passwordHash`) and empty-`mfaRecoveryCodes` paths.
> 3. For `AppAuthHooks`, verify each hook method persists a row via `prisma.auditLog.create` with the correct event slug + sanitized payload. Use `expect.objectContaining` and explicitly assert no `passwordHash`/`mfaSecret`/`jti` leaks into `metadata`.
> 4. For `auth.config.spec.ts`, call the zod schema directly with partial/bad envs and assert `.safeParse().success === false` with the right `issue.path`.
> 5. Enforce coverage thresholds in `jest.config.ts` for `src/auth/**` at `branches: 85, lines: 90, functions: 90`.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - No network, no filesystem, no DB — pure unit tests.
> - Never assert on library internals; only on the adapter's observable behavior.
>
> Verification:
>
> - `pnpm --filter api test -- prisma-user.repository prisma-platform-user.repository app-auth.hooks auth.config` — expected: all green.
> - `pnpm --filter api test -- --coverage` — expected: `src/auth/**` ≥ 90% lines.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P17-1 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P17-2 — API unit tests — email providers

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** M
- **Depends on:** `Phase 6`

### Description

Unit-test both `IEmailProvider` implementations. `MailpitEmailProvider` uses `nodemailer` against a mocked SMTP transport; `ResendEmailProvider` mocks the `resend` client. Each method in `IEmailProvider` (`sendVerificationEmail`, `sendPasswordResetEmail`, `sendNewSessionAlert`, `sendInvitationEmail`, etc.) is exercised and asserted on envelope + subject + key template variables. Backs FCM rows #5, #6, #7, #15, #21, #31 and Appendix B `IEmailProvider`.

### Acceptance Criteria

- [ ] `apps/api/src/auth/mailpit-email.provider.spec.ts` mocks `nodemailer.createTransport` and asserts each send passes the right `to`, `from`, `subject`, and template payload.
- [ ] `apps/api/src/auth/resend-email.provider.spec.ts` mocks the `resend` SDK (`jest.mock('resend')`) and asserts `emails.send` is called with the correct arguments.
- [ ] Both specs verify locale/template selection logic if templates are keyed by locale.
- [ ] Both specs assert error paths — transport failure bubbles a clear error with no PII in the message.
- [ ] No real SMTP / real Resend network call made during the test.

### Files to create / modify

- `apps/api/src/auth/mailpit-email.provider.spec.ts` — new spec.
- `apps/api/src/auth/resend-email.provider.spec.ts` — new spec.

### Agent Execution Prompt

> Role: Senior QA engineer with experience mocking `nodemailer` and third-party SDKs.
>
> Context: Covers `docs/DEVELOPMENT_PLAN.md` §17.1 (email providers bullet). Both providers implement `IEmailProvider` from `@bymax-one/nest-auth`.
>
> Objective: Prove each provider forms the correct envelope + body per event, without hitting the network.
>
> Steps:
>
> 1. For Mailpit: `jest.mock('nodemailer')` and return a `createTransport` stub whose `sendMail` is a Jest fn. Instantiate `MailpitEmailProvider` with a fake config. Call every method on `IEmailProvider` and assert `sendMail` payloads.
> 2. For Resend: `jest.mock('resend')` returning a `Resend` constructor whose `emails.send` is a Jest fn. Same exhaustive coverage.
> 3. If templates switch by locale, add one test per locale branch.
> 4. Add an error-path test per provider: transport throws → expect provider to throw a descriptive `Error` without `apiKey` or SMTP creds in the message.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Never touch network, filesystem, or real Mailpit.
> - Use `expect.objectContaining` liberally — lock only the contract, not the template HTML verbatim.
>
> Verification:
>
> - `pnpm --filter api test -- mailpit-email.provider resend-email.provider` — expected: all green.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P17-2 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P17-3 — API unit tests — domain modules (tenants/projects)

- **Status:** 🟢 Done
- **Priority:** Medium
- **Size:** M
- **Depends on:** `Phase 7`

### Description

Unit-test the example domain modules' role gates and tenant scoping logic. `tenants` and `projects` services should reject cross-tenant reads, enforce `@Roles` hierarchy (via `hasRole`), and surface the right auth errors. Backs FCM rows #18, #19, #20.

### Acceptance Criteria

- [ ] `apps/api/src/projects/projects.service.spec.ts` covers create/read/update/delete with mocked Prisma; asserts `tenantId` filter is applied on every query.
- [ ] `apps/api/src/projects/projects.controller.spec.ts` (or integration via `TestingModule`) proves the controller rejects requests without the required role via `RolesGuard`.
- [ ] `apps/api/src/tenants/tenants.service.spec.ts` covers membership checks and role-gated mutations.
- [ ] Tests assert the library's `hasRole` utility is consulted (via mock or behavioral check) for hierarchy resolution.
- [ ] No real DB — `PrismaService` mocked via `jest-mock-extended`.

### Files to create / modify

- `apps/api/src/projects/projects.service.spec.ts` — new spec.
- `apps/api/src/projects/projects.controller.spec.ts` — new spec.
- `apps/api/src/tenants/tenants.service.spec.ts` — new spec.

### Agent Execution Prompt

> Role: Senior QA engineer with NestJS module testing experience.
>
> Context: Covers `docs/DEVELOPMENT_PLAN.md` §17.1 (domain modules bullet). The example domain modules live in `apps/api/src/tenants` and `apps/api/src/projects`.
>
> Objective: Prove role gates and tenant isolation at the unit level.
>
> Steps:
>
> 1. Build a `TestingModule` per service, providing a mocked `PrismaService`.
> 2. Exercise each public service method; assert every Prisma call carries the current user's `tenantId` in the `where` clause.
> 3. For controller tests, use `Test.createTestingModule` + `overrideGuard(RolesGuard)` only to verify `@Roles` metadata is present — do NOT disable the guard globally.
> 4. For role hierarchy, spy on `hasRole` (imported from `@bymax-one/nest-auth`) and assert it is called with `(userRole, requiredRole, hierarchy)`.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Never hit a real DB.
> - Never hand-roll RBAC logic — always delegate to `hasRole` / `RolesGuard`.
>
> Verification:
>
> - `pnpm --filter api test -- projects tenants` — expected: all green.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P17-3 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P17-4 — API e2e — auth bundle 1 (register/verify/login/logout/refresh/revoke)

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** L
- **Depends on:** `P17-8`

### Description

Five supertest e2e specs covering the auth core against a real Postgres + Redis via `docker-compose.test.yml`. Each spec boots the Nest app, uses the bootstrap from P17-8, and asserts cookies, error codes, and Redis side-effects. Covers FCM rows #1, #2, #3, #4, #5, #29.

### Acceptance Criteria

- [ ] `apps/api/test/register-and-verify.e2e-spec.ts` — `POST /auth/register` creates user, sends verification email (Mailpit-polled), `POST /auth/verify-email` flips `emailVerified=true`.
- [ ] `apps/api/test/login-and-logout.e2e-spec.ts` — login sets `access_token` + `refresh_token` + `has_session` cookies; logout clears them and revokes the refresh token in Redis.
- [ ] `apps/api/test/refresh-rotation.e2e-spec.ts` — asserts refresh rotates the access cookie, that the old refresh is one-use, and exercises the grace-window race (two concurrent refresh calls both succeed within grace).
- [ ] `apps/api/test/jwt-revocation.e2e-spec.ts` — after "sign out everywhere", a previously valid access token is rejected on next request (`AUTH_ERROR_CODES.TOKEN_REVOKED` or equivalent).
- [ ] Error-code path: wrong password returns `INVALID_CREDENTIALS` (not `USER_NOT_FOUND`) — anti-enumeration verified.
- [ ] All specs use the Mailpit helper from P17-8 to read OTPs/tokens.

### Files to create / modify

- `apps/api/test/register-and-verify.e2e-spec.ts` — new spec.
- `apps/api/test/login-and-logout.e2e-spec.ts` — new spec.
- `apps/api/test/refresh-rotation.e2e-spec.ts` — new spec.
- `apps/api/test/jwt-revocation.e2e-spec.ts` — new spec.

### Agent Execution Prompt

> Role: Senior QA engineer writing Jest + supertest e2e suites against NestJS.
>
> Context: Covers `docs/DEVELOPMENT_PLAN.md` §17.2 (auth core specs). Runs against a real Postgres + Redis booted via `docker-compose.test.yml`. Bootstrap lives in P17-8.
>
> Objective: Lock the register → verify → login → refresh → logout → revoke chain end-to-end.
>
> Steps:
>
> 1. In each spec, call the shared bootstrap to get a Nest app + supertest agent + Prisma handle.
> 2. Register a fresh user per test, poll Mailpit at `http://localhost:58025/api/v1/messages` for the verification OTP (use helper from P17-8).
> 3. Assert `Set-Cookie` headers for `access_token` (HttpOnly), `refresh_token` (Path=/api/auth, HttpOnly), and `has_session` (non-HttpOnly).
> 4. For rotation, capture the refresh cookie, call `/auth/refresh`, assert new access cookie, then call `/auth/refresh` with the old refresh — expect 401. For grace-window: fire two refreshes within the configured window and assert both 200.
> 5. For revocation, call `/auth/logout-all`, then reuse the old access token — expect 401 with revoked code.
> 6. For anti-enumeration, assert wrong-password and unknown-email both return the same shared error code.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - No snapshot testing of cookie values; assert on cookie attributes instead.
> - Each `describe` must truncate tables between tests via the helper from P17-8.
>
> Verification:
>
> - `pnpm --filter api test:e2e -- register-and-verify login-and-logout refresh-rotation jwt-revocation` — expected: all green.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P17-4 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P17-5 — API e2e — password / MFA / recovery codes

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** L
- **Depends on:** `P17-8`

### Description

Four supertest e2e specs covering password reset (token mode + OTP mode), MFA setup + challenge + disable, and recovery codes. Mailpit must be polled for the reset link/OTP. Covers FCM rows #6, #7, #8, #9, #10, #11.

### Acceptance Criteria

- [ ] `apps/api/test/password-reset-token.e2e-spec.ts` — request reset → read token from Mailpit → `POST /auth/reset-password` → can log in with new password.
- [ ] `apps/api/test/password-reset-otp.e2e-spec.ts` — same flow but in OTP mode (driven by `PASSWORD_RESET_METHOD=otp` env for this spec).
- [ ] `apps/api/test/mfa-setup-challenge-disable.e2e-spec.ts` — `POST /auth/mfa/setup` returns QR/secret → confirm with `otplib`-generated TOTP → next login requires MFA challenge → `POST /auth/mfa/disable`.
- [ ] `apps/api/test/recovery-codes.e2e-spec.ts` — codes are generated at enrollment, a single code consumes MFA challenge once (and only once), and rotation of codes invalidates the old set.
- [ ] All tests use `otplib` for TOTP generation; no hardcoded secrets.
- [ ] Anti-enumeration: requesting reset for unknown email returns the same generic response as known email.

### Files to create / modify

- `apps/api/test/password-reset-token.e2e-spec.ts` — new spec.
- `apps/api/test/password-reset-otp.e2e-spec.ts` — new spec.
- `apps/api/test/mfa-setup-challenge-disable.e2e-spec.ts` — new spec.
- `apps/api/test/recovery-codes.e2e-spec.ts` — new spec.

### Agent Execution Prompt

> Role: Senior QA engineer testing password reset + MFA flows end-to-end.
>
> Context: Covers `docs/DEVELOPMENT_PLAN.md` §17.2 (password-reset, MFA, recovery-codes bullets). Uses the P17-8 bootstrap and Mailpit poller.
>
> Objective: Lock the password-reset and MFA flows end-to-end in both configured modes.
>
> Steps:
>
> 1. For token-mode reset, set `PASSWORD_RESET_METHOD=token` via test env, boot app, request reset, poll Mailpit for the link, extract the token from the URL, call `POST /auth/reset-password`, verify new-password login works.
> 2. For OTP mode, boot a second test app instance with `PASSWORD_RESET_METHOD=otp`; poll Mailpit for the OTP; submit via `POST /auth/reset-password` with `{ email, otp, newPassword }`.
> 3. For MFA setup, call `POST /auth/mfa/setup` → parse returned secret → generate TOTP via `otplib.authenticator.generate(secret)` → call `POST /auth/mfa/setup/confirm`.
> 4. Re-login → expect `MFA_REQUIRED` → call `POST /auth/mfa/challenge` with fresh TOTP → expect full login cookies.
> 5. For recovery codes: capture codes at enrollment, consume one via challenge, attempt to reuse same code → expect failure.
> 6. For anti-enumeration, always assert same-shaped response for known vs unknown emails.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Use `otplib` (not hand-rolled HMAC) for TOTP.
> - Mailpit helper must time out at 5 s per poll to keep the suite fast.
>
> Verification:
>
> - `pnpm --filter api test:e2e -- password-reset mfa recovery-codes` — expected: all green.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P17-5 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P17-6 — API e2e — sessions / brute-force / throttle

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** L
- **Depends on:** `P17-8`

### Description

Four supertest e2e specs covering session management (list/revoke + FIFO eviction), brute-force lockout, and throttler behavior. The FIFO eviction spec creates `defaultMaxSessions + 1` sessions and asserts the oldest is evicted AND the `onSessionEvicted` hook fires (via an `AuditLog` row). Covers FCM rows #13, #14, #16, #17.

### Acceptance Criteria

- [ ] `apps/api/test/sessions-list-revoke.e2e-spec.ts` — `GET /auth/sessions` lists current sessions; `DELETE /auth/sessions/:id` revokes one; "revoke all" revokes every session.
- [ ] `apps/api/test/session-fifo-eviction.e2e-spec.ts` — creates `defaultMaxSessions + 1` sessions (distinct user-agents), asserts the oldest is absent from `GET /auth/sessions` AND an `AuditLog` row with event `session.evicted` exists, proving `onSessionEvicted` fired.
- [ ] `apps/api/test/brute-force-lockout.e2e-spec.ts` — after `bruteForce.maxAttempts` failed logins, next login returns `ACCOUNT_LOCKED`; Redis key `nest-auth-example:lf:{hash}` visible via a direct ioredis check.
- [ ] `apps/api/test/throttle-demo.e2e-spec.ts` — exceeding the throttler limit on `/health/throttle-demo` returns `429`.
- [ ] All specs flush relevant Redis keys before/after via the P17-8 helper.

### Files to create / modify

- `apps/api/test/sessions-list-revoke.e2e-spec.ts` — new spec.
- `apps/api/test/session-fifo-eviction.e2e-spec.ts` — new spec.
- `apps/api/test/brute-force-lockout.e2e-spec.ts` — new spec.
- `apps/api/test/throttle-demo.e2e-spec.ts` — new spec.

### Agent Execution Prompt

> Role: Senior QA engineer testing session + rate-limit flows end-to-end.
>
> Context: Covers `docs/DEVELOPMENT_PLAN.md` §17.2 (sessions-list-revoke, session-fifo-eviction, brute-force-lockout, throttle-demo bullets). FIFO eviction is FCM row #14 and explicitly requires asserting `onSessionEvicted`.
>
> Objective: Prove session listing, revocation, FIFO eviction with hook firing, brute-force lockout, and per-route throttling.
>
> Steps:
>
> 1. For list/revoke: log in from three distinct user-agents; GET the sessions list (assert 3 entries with distinct device fingerprints); DELETE one; assert list shows 2.
> 2. For FIFO: read `defaultMaxSessions` from config; create N+1 logins with distinct `User-Agent` headers; assert the oldest session no longer appears and an `AuditLog` row with `event = 'session.evicted'` exists for it.
> 3. For brute-force: POST wrong-password `maxAttempts` times; assert the next attempt (even with correct password) returns `ACCOUNT_LOCKED`. Use a direct `ioredis` client to assert the `nest-auth-example:lf:*` key is present.
> 4. For throttle: hit `/health/throttle-demo` beyond the configured limit within the window; assert `429`.
> 5. Between tests, flush brute-force + session keys via the P17-8 helper; truncate tables.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Do not mock Redis — these tests must exercise the real key layout.
> - The FIFO spec must not depend on wall-clock timing; use distinct User-Agent values to disambiguate sessions.
>
> Verification:
>
> - `pnpm --filter api test:e2e -- sessions-list-revoke session-fifo-eviction brute-force-lockout throttle-demo` — expected: all green.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P17-6 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P17-7 — API e2e — RBAC / tenant / status / invitations / platform / ws / oauth

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** L
- **Depends on:** `P17-8`

### Description

Seven supertest e2e specs covering role hierarchy, cross-tenant isolation, account status enforcement, invitations, platform admin isolation, WebSocket auth, and OAuth Google (mocked callback). Covers FCM rows #12, #18, #19, #20, #21, #22, #23, #24.

### Acceptance Criteria

- [ ] `apps/api/test/rbac.e2e-spec.ts` — `OWNER` can call `VIEWER`-gated routes (hierarchy); `MEMBER` cannot call `OWNER` routes.
- [ ] `apps/api/test/tenant-isolation.e2e-spec.ts` — user in tenant A receives `404`/`403` when accessing tenant B's `projects/:id`.
- [ ] `apps/api/test/status-enforcement.e2e-spec.ts` — admin sets user to `SUSPENDED`; next authenticated request returns `USER_BLOCKED`.
- [ ] `apps/api/test/invitations.e2e-spec.ts` — admin POSTs invitation → email captured → accept flow creates user with the invited role + tenant.
- [ ] `apps/api/test/platform-auth-isolation.e2e-spec.ts` — platform JWT does not authenticate tenant routes and vice versa; `JwtPlatformGuard` rejects tenant tokens.
- [ ] `apps/api/test/websocket-auth.e2e-spec.ts` — reuses / extends the spec from Phase 10 if present; otherwise creates it: connect with cookies → receive; without cookies → reject.
- [ ] `apps/api/test/oauth-google.e2e-spec.ts` — Google token exchange mocked via a fixture server; callback creates/links a user.

### Files to create / modify

- `apps/api/test/rbac.e2e-spec.ts` — new spec.
- `apps/api/test/tenant-isolation.e2e-spec.ts` — new spec.
- `apps/api/test/status-enforcement.e2e-spec.ts` — new spec.
- `apps/api/test/invitations.e2e-spec.ts` — new spec.
- `apps/api/test/platform-auth-isolation.e2e-spec.ts` — new spec.
- `apps/api/test/websocket-auth.e2e-spec.ts` — new spec (or edit if Phase 10 produced a stub).
- `apps/api/test/oauth-google.e2e-spec.ts` — new spec.
- `apps/api/test/helpers/google-oauth-fixture.ts` — new fixture HTTP server.

### Agent Execution Prompt

> Role: Senior QA engineer writing multi-tenant / RBAC / OAuth e2e tests.
>
> Context: Covers `docs/DEVELOPMENT_PLAN.md` §17.2 (remaining bullets). Uses P17-8 bootstrap.
>
> Objective: Lock authorization, tenant isolation, invitations, platform auth, WebSocket auth, and OAuth (mocked) end-to-end.
>
> Steps:
>
> 1. Seed two tenants + users with varied roles. Run role-hierarchy and cross-tenant matrices.
> 2. For status enforcement, flip status via admin route → reuse the same JWT → expect blocked.
> 3. For invitations, capture the invite email in Mailpit → POST `/auth/invitations/accept` → verify the new user's tenant + role.
> 4. For platform isolation, acquire a platform JWT, call tenant route → expect 401/403; reverse direction likewise.
> 5. For WebSocket, reuse the P10-3 spec layout (open with cookies, receive `notification:new`, reject without cookies).
> 6. For OAuth, stand up `google-oauth-fixture.ts` (an Express server on an ephemeral port) that answers `/token` and `/userinfo` with deterministic payloads; point `OAUTH_GOOGLE_*` env vars at it; drive the callback via supertest. Assert a new user is created with `oauthProvider='google'`.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - OAuth test MUST NOT call real Google — use the fixture server only.
> - Tenant-isolation assertions must not reveal existence of other tenants' records (expect 404, not 403).
>
> Verification:
>
> - `pnpm --filter api test:e2e -- rbac tenant-isolation status-enforcement invitations platform-auth-isolation websocket-auth oauth-google` — expected: all green.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P17-7 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P17-8 — API e2e bootstrap (Jest setup, Mailpit poller, DB helpers)

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** M
- **Depends on:** `Phase 6`

### Description

Shared Jest setup for every e2e spec. Boots a `NestApplication` against `DATABASE_URL_TEST`, runs `prisma migrate deploy`, provides truncation helpers, a Redis flusher, and a Mailpit poller hitting `http://localhost:58025/api/v1/messages`. Exposed via `apps/api/test/setup.ts` + `apps/api/test/helpers/*`.

### Acceptance Criteria

- [ ] `apps/api/test/setup.ts` — `createTestApp(options?)` returns `{ app, agent, prisma, redis }` and closes them via `afterAll`.
- [ ] On first call per process, runs `prisma migrate deploy --schema=apps/api/prisma/schema.prisma` against `DATABASE_URL_TEST`.
- [ ] `apps/api/test/helpers/db.ts` — `truncate(prisma, tables?: string[])` truncates all app tables (RESTART IDENTITY CASCADE) by default.
- [ ] `apps/api/test/helpers/redis.ts` — `flushTestKeys(redis)` deletes keys matching `nest-auth-example:*`.
- [ ] `apps/api/test/helpers/mailpit.ts` — `waitForEmail({ to, subjectMatch }, timeoutMs=5000)` polls `http://localhost:58025/api/v1/messages`, returns the message; has `extractOtp(msg)` and `extractResetToken(msg)` helpers.
- [ ] `apps/api/jest.e2e.config.ts` points `setupFilesAfterEnv` at `test/setup.ts` and sets `testEnvironment: 'node'`.
- [ ] `pnpm --filter api test:e2e` runs a smoke spec end-to-end against `docker-compose.test.yml`.

### Files to create / modify

- `apps/api/test/setup.ts` — new.
- `apps/api/test/helpers/db.ts` — new.
- `apps/api/test/helpers/redis.ts` — new.
- `apps/api/test/helpers/mailpit.ts` — new.
- `apps/api/jest.e2e.config.ts` — new (or update existing e2e config).
- `apps/api/package.json` — ensure `test:e2e` script targets the e2e config.
- `docker-compose.test.yml` — ensure Mailpit publishes `58025`.

### Agent Execution Prompt

> Role: Senior QA tooling engineer.
>
> Context: Covers `docs/DEVELOPMENT_PLAN.md` §17.2 (test bootstrap bullets). Every e2e spec (P17-4 through P17-7) depends on these helpers.
>
> Objective: Provide the shared test harness so specs stay small and fast.
>
> Steps:
>
> 1. In `setup.ts`, lazily run `prisma migrate deploy` against `DATABASE_URL_TEST` (guard with a module-level `migrated` flag).
> 2. `createTestApp` creates a Nest testing module, applies the same global pipes/filters as `main.ts`, listens on an ephemeral port, returns `{ app, agent, prisma, redis }`.
> 3. `truncate` discovers tables from `prisma._getDmmf()` or hardcodes the known list, then issues one `TRUNCATE ... RESTART IDENTITY CASCADE;`.
> 4. `flushTestKeys` uses `redis.scanStream({ match: 'nest-auth-example:*' })` + pipeline `del`.
> 5. `waitForEmail` polls Mailpit at intervals of 100 ms with a default 5 s timeout, returning the first matching message. `extractOtp` reads the 6-digit code via regex; `extractResetToken` pulls the `token` query param out of any URL in the body.
> 6. Wire `jest.e2e.config.ts` with `setupFilesAfterEnv: ['<rootDir>/test/setup.ts']`, `testMatch: ['<rootDir>/test/**/*.e2e-spec.ts']`, `testTimeout: 30000`.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Helpers must be framework-agnostic (no global state leaking between specs).
> - Mailpit URL configurable via env var (`MAILPIT_URL`, default `http://localhost:58025`).
>
> Verification:
>
> - `pnpm infra:test:up && pnpm --filter api prisma migrate deploy && pnpm --filter api test:e2e -- --listTests` — expected: lists specs without error.
> - A trivial smoke spec that calls `/api/health` through `createTestApp` — expected: green.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P17-8 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P17-9 — Web unit tests (Vitest) — schemas, auth-errors, OtpInput

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** M
- **Depends on:** `Phase 13`

### Description

Vitest unit tests for the web app's zod schemas (login, register, reset-password), the `auth-errors.ts` coverage test asserting every key in `AUTH_ERROR_CODES` has a matching user-facing message, and `<OtpInput />` component behavior (paste, arrow keys, backspace). Covers FCM row #29 + schema/UI units.

### Acceptance Criteria

- [ ] `apps/web/lib/schemas/login.schema.test.ts`, `.../register.schema.test.ts`, `.../reset-password.schema.test.ts` cover positive + negative cases per field.
- [ ] `apps/web/lib/auth-errors.test.ts` iterates `Object.keys(AUTH_ERROR_CODES)` (imported from `@bymax-one/nest-auth/shared`) and asserts each has a non-empty localized message in `auth-errors.ts`.
- [ ] `apps/web/components/auth/OtpInput.test.tsx` uses `@testing-library/react` to verify paste-into-first-cell spreads digits, backspace navigates back, and arrow keys move focus.
- [ ] `apps/web/vitest.config.ts` configured with `jsdom` environment and path aliases matching `tsconfig.json`.
- [ ] `pnpm --filter web test` runs all unit tests green.

### Files to create / modify

- `apps/web/lib/schemas/login.schema.test.ts` — new.
- `apps/web/lib/schemas/register.schema.test.ts` — new.
- `apps/web/lib/schemas/reset-password.schema.test.ts` — new.
- `apps/web/lib/auth-errors.test.ts` — new.
- `apps/web/components/auth/OtpInput.test.tsx` — new.
- `apps/web/vitest.config.ts` — new or updated.
- `apps/web/package.json` — add `test` script pointing at Vitest.

### Agent Execution Prompt

> Role: Senior QA engineer with Vitest + React Testing Library experience.
>
> Context: Covers `docs/DEVELOPMENT_PLAN.md` §17.3. `auth-errors.ts` was built in Phase 13.
>
> Objective: Lock form validation, the full `AUTH_ERROR_CODES` coverage contract, and OTP input UX.
>
> Steps:
>
> 1. For each schema, write one positive test and one test per validation rule (bad email, short password, mismatched confirm, etc.).
> 2. For `auth-errors.test.ts`: `import { AUTH_ERROR_CODES } from '@bymax-one/nest-auth/shared'` and `authErrors` from the local file, then `it.each(Object.keys(AUTH_ERROR_CODES))('has message for %s', (code) => { expect(authErrors[code]).toBeTruthy() })`.
> 3. For OtpInput, mount with `render`, simulate paste of `'123456'` into the first cell, assert each cell value; simulate backspace from cell 3 and assert focus moved to cell 2.
> 4. Configure Vitest with `environment: 'jsdom'`, `setupFiles: ['./vitest.setup.ts']` that registers `@testing-library/jest-dom/vitest`.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Do NOT import from `@bymax-one/nest-auth` server/nextjs subpaths — web unit tests use `/shared` and `/react` only.
> - Coverage: `apps/web/lib/**` ≥ 80% lines.
>
> Verification:
>
> - `pnpm --filter web test -- --run` — expected: all green.
> - `pnpm --filter web test -- --coverage` — expected: thresholds met.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P17-9 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P17-10 — Web e2e (Playwright) — full user journeys + auth fixture

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** L
- **Depends on:** `P17-4`, `P17-5`, `P17-8`

### Description

End-to-end Playwright suite exercising real user journeys against the stack booted by `docker-compose.test.yml`. Includes a reusable `auth.ts` fixture that performs a cookie-based login once and reuses storage state across specs. Spec list: login-happy, login-wrong-password, forgot-password (reads token from Mailpit), mfa-enroll-and-login (uses `otplib`), invitations (second browser context accepts the invite), platform-admin, tenant-switcher.

### Acceptance Criteria

- [ ] `apps/web/e2e/fixtures/auth.ts` provides an `authenticatedPage` fixture that logs in once, persists storage state at `.auth/<role>.json`, and reuses it across tests.
- [ ] `apps/web/e2e/login-happy.spec.ts` — login succeeds, `/dashboard` renders the user name.
- [ ] `apps/web/e2e/login-wrong-password.spec.ts` — wrong password surfaces the message from `auth-errors.ts` keyed by `INVALID_CREDENTIALS`.
- [ ] `apps/web/e2e/forgot-password.spec.ts` — submits email, opens Mailpit UI or queries `http://localhost:58025/api/v1/messages`, extracts the reset link, follows it, sets new password, logs in.
- [ ] `apps/web/e2e/mfa-enroll-and-login.spec.ts` — enrolls in MFA (extracts secret from the QR payload or returned secret), uses `otplib` to pass the challenge on next login.
- [ ] `apps/web/e2e/invitations.spec.ts` — admin context sends invite; a second browser context opens the invite link from Mailpit and accepts.
- [ ] `apps/web/e2e/platform-admin.spec.ts` — platform login portal, platform dashboard visible, tenant dashboard not accessible with platform cookies.
- [ ] `apps/web/e2e/tenant-switcher.spec.ts` — user with two tenants switches, dashboard reloads with tenant-scoped data.
- [ ] `apps/web/playwright.config.ts` configured with `webServer` entries for api + web (or documents using the running `docker-compose.test.yml`), `storageState` per project, and `use: { baseURL }` from env.
- [ ] All suites green in CI via `pnpm --filter web exec playwright test`.

### Files to create / modify

- `apps/web/playwright.config.ts` — new or updated.
- `apps/web/e2e/fixtures/auth.ts` — new.
- `apps/web/e2e/fixtures/mailpit.ts` — helper to poll Mailpit HTTP API.
- `apps/web/e2e/login-happy.spec.ts` — new.
- `apps/web/e2e/login-wrong-password.spec.ts` — new.
- `apps/web/e2e/forgot-password.spec.ts` — new.
- `apps/web/e2e/mfa-enroll-and-login.spec.ts` — new.
- `apps/web/e2e/invitations.spec.ts` — new.
- `apps/web/e2e/platform-admin.spec.ts` — new.
- `apps/web/e2e/tenant-switcher.spec.ts` — new.
- `apps/web/package.json` — `e2e` script + `otplib` dev dep.

### Agent Execution Prompt

> Role: Senior QA engineer writing Playwright suites for a Next.js + NestJS stack.
>
> Context: Covers `docs/DEVELOPMENT_PLAN.md` §17.4. API e2e (P17-4, P17-5) and the Mailpit bootstrap (P17-8) must be merged first.
>
> Objective: Prove the full user journeys work through the real web UI, not just the API.
>
> Steps:
>
> 1. Build `e2e/fixtures/auth.ts` exporting a typed fixture `authenticatedPage` that checks for `.auth/<role>.json`; if missing, drives the login form, waits for `/dashboard`, and calls `context.storageState({ path })`.
> 2. Configure `playwright.config.ts` projects: `chromium-tenant-admin`, `chromium-member`, `chromium-platform-admin`, each with its own `storageState`.
> 3. Forgot-password spec uses `e2e/fixtures/mailpit.ts` to poll `http://localhost:58025/api/v1/messages?query=to%3A<email>`, extract the reset URL from the latest matching message, `page.goto(url)`, submit new password.
> 4. MFA spec: enroll from `/dashboard/security`, grab the `otpauth://` URI from the QR payload or the API response, extract `secret`, use `otplib.authenticator.generate(secret)` to pass the challenge on the next login attempt.
> 5. Invitations spec: use a second `browser.newContext()` with no storage state to accept the invite; assert membership + role afterwards.
> 6. Platform + tenant-switcher specs: drive their respective UIs; assert URL + visible heading per step.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Use `page.getByRole` / `getByLabel` locators (no brittle CSS selectors).
> - `.auth/` directory is gitignored.
> - Mailpit polling bounded at 10 s per step.
>
> Verification:
>
> - `pnpm --filter web exec playwright test --reporter=line` — expected: all green.
> - `pnpm --filter web exec playwright test --project=chromium-member login-happy` — expected: green (per-project smoke).

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P17-10 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## Completion log

- P17-8 ✅ 2026-04-25 — API e2e bootstrap: setup.ts, db/redis/mailpit helpers, jest.e2e.config.ts
- P17-1 ✅ 2026-04-25 — API unit tests: repositories, hooks, auth config (82 tests, 0 errors)
- P17-2 ✅ 2026-04-25 — API unit tests: mailpit + resend email providers (21 tests)
- P17-3 ✅ 2026-04-25 — API unit tests: projects service/controller, tenants service (10 tests)
- P17-9 ✅ 2026-04-25 — Web unit tests: 8 auth schemas, auth-errors exhaustiveness, OtpInput (102 tests)
- P17-4 ✅ 2026-04-25 — API e2e: register-and-verify, login-and-logout, refresh-rotation, jwt-revocation
- P17-5 ✅ 2026-04-25 — API e2e: password-reset-token, password-reset-otp, mfa-setup-challenge-disable, recovery-codes
- P17-6 ✅ 2026-04-25 — API e2e: sessions-list-revoke, session-fifo-eviction, brute-force-lockout, throttle-demo
- P17-7 ✅ 2026-04-25 — API e2e: rbac, tenant-isolation, status-enforcement (+ existing invitations/platform/ws/oauth)
- P17-10 ✅ 2026-04-25 — Web e2e: login-happy, login-wrong-password, forgot-password, mfa-enroll-and-login, invitations, tenant-switcher (+ existing platform specs)
