# Phase 6 — Library Wiring: `auth.config.ts`, Repositories, Email, Hooks — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-6--library-wiring-authconfigts-repositories-email-hooks) §Phase 6
> **Total tasks:** 6
> **Progress:** 🔴 0 / 6 done (0%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID | Task | Status | Priority | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| P6-1 | `auth.config.ts` — `buildAuthOptions` factory | 🔴 | High | L | Phase 5 |
| P6-2 | `PrismaUserRepository` implementing `IUserRepository` | 🔴 | High | L | P6-1 |
| P6-3 | `PrismaPlatformUserRepository` implementing `IPlatformUserRepository` | 🔴 | High | M | P6-1 |
| P6-4 | `MailpitEmailProvider` implementing `IEmailProvider` | 🔴 | High | M | P6-1 |
| P6-5 | `ResendEmailProvider` implementing `IEmailProvider` | 🔴 | Medium | M | P6-4 |
| P6-6 | `AppAuthHooks` implementing `IAuthHooks` (audit log) | 🔴 | High | M | P6-1 |

---

## P6-1 — `auth.config.ts` — `buildAuthOptions` factory

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** L
- **Depends on:** Phase 5 (`ConfigService` + zod env schema available)

### Description
Author a fully-typed factory `buildAuthOptions(config: ConfigService): BymaxAuthModuleOptions` that returns every option group required by §Phase 6.1 of the development plan. The factory is the single source of truth consumed by `BymaxAuthModule.registerAsync` in Phase 7; it must fail-fast on bad inputs (entropy rejection for `JWT_SECRET`, base64 shape for `MFA_ENCRYPTION_KEY`) and conditionally include `oauth.google` only when both Google env vars are set.

### Acceptance Criteria
- [ ] `apps/api/src/auth/auth.config.ts` exports `buildAuthOptions(config: ConfigService): BymaxAuthModuleOptions`.
- [ ] `jwt` block: `secret` from env (entropy rejection is library-side, but the factory surfaces the value verbatim), `accessExpiresIn: '15m'`, `refreshExpiresInDays: 7`, `refreshGraceWindowSeconds: 30`.
- [ ] `mfa` block: `encryptionKey` from `MFA_ENCRYPTION_KEY`, `issuer: 'nest-auth-example'`, `recoveryCodeCount: 8`.
- [ ] `sessions: { enabled: true, defaultMaxSessions: 5, evictionStrategy: 'fifo' }`.
- [ ] `bruteForce: { maxAttempts: 5, windowSeconds: 900 }`.
- [ ] `passwordReset: { method: config.get('PASSWORD_RESET_METHOD') ?? 'token', tokenTtlSeconds: 600, otpTtlSeconds: 600, otpLength: 6 }`.
- [ ] `emailVerification: { required: true, otpTtlSeconds: 600 }`.
- [ ] `platform: { enabled: true }`.
- [ ] `invitations: { enabled: true, tokenTtlSeconds: 172_800 }`.
- [ ] `oauth.google` present only when both `OAUTH_GOOGLE_CLIENT_ID` and `OAUTH_GOOGLE_CLIENT_SECRET` are set; otherwise the `oauth` key is omitted entirely.
- [ ] `roles.hierarchy = { OWNER: ['ADMIN','MEMBER','VIEWER'], ADMIN: ['MEMBER','VIEWER'], MEMBER: ['VIEWER'], VIEWER: [] }`.
- [ ] `roles.platformHierarchy = { SUPER_ADMIN: ['SUPPORT'], SUPPORT: [] }`.
- [ ] `blockedStatuses: ['BANNED', 'INACTIVE', 'SUSPENDED']`.
- [ ] `redisNamespace: 'nest-auth-example'`.
- [ ] `routePrefix: 'auth'`.
- [ ] `cookies.resolveDomains` implemented — returns `['.<PUBLIC_DOMAIN>']` in production when `PUBLIC_DOMAIN` is set, else `undefined` (function omitted).
- [ ] `tenantIdResolver` extracts `req.headers['x-tenant-id']` safely (no `as` casts); throws when the header is missing or empty.
- [ ] `secureCookies: process.env.NODE_ENV === 'production'`.
- [ ] File imports the options type as `import type { BymaxAuthModuleOptions } from '@bymax-one/nest-auth'`.

### Files to create / modify
- `apps/api/src/auth/auth.config.ts` — new file; exports `buildAuthOptions`.
- `apps/api/src/config/env.schema.ts` — ensure `PASSWORD_RESET_METHOD`, `PUBLIC_DOMAIN`, `OAUTH_GOOGLE_*` are represented.

### Agent Execution Prompt

> Role: Senior NestJS engineer familiar with `@bymax-one/nest-auth` and zod-validated configuration.
>
> Context: Phase 6 produces the factory that Phase 7 feeds to `BymaxAuthModule.registerAsync`. Covers FCM rows **#3 (refresh grace window)**, **#5 (email verification required)**, **#13 (sessions enabled)**, **#14 (FIFO eviction)**, **#16 (brute-force thresholds)**, **#17 (throttling is separate)**, **#18/#19 (roles)**, **#20 (tenant resolver)**, **#23 (blocked statuses)**. The options interface lives at `../nest-auth/src/server/interfaces/auth-module-options.interface.ts`.
>
> Objective: Implement `buildAuthOptions(config: ConfigService): BymaxAuthModuleOptions` in `apps/api/src/auth/auth.config.ts`.
>
> Steps:
> 1. `import type { BymaxAuthModuleOptions } from '@bymax-one/nest-auth'` — types only, never a runtime import for the interface.
> 2. Read every env var through `ConfigService.get(...)`; never touch `process.env` directly except for `secureCookies` default.
> 3. Build the options object exactly matching the Acceptance Criteria — use an explicit `const oauth = ... ?? undefined` branch and spread `...(oauth && { oauth })` so the key is omitted cleanly.
> 4. Implement `tenantIdResolver`: `const id = req.headers['x-tenant-id']; if (typeof id !== 'string' || id.length === 0) throw new Error('Missing x-tenant-id header'); return id`.
> 5. Implement `cookies.resolveDomains` as `(host) => [\`.${publicDomain}\`]` when in production AND `publicDomain` set, else leave the whole `resolveDomains` field unset.
> 6. Keep the function pure — no side effects, no logging of secrets.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (ESM, strict TS, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
> - Never hard-code secrets or log them.
> - Import the options interface as `type` — the library exposes it only as a type export.
> - Do not re-validate `JWT_SECRET` entropy or `MFA_ENCRYPTION_KEY` length — the library's `resolveOptions()` already does that at module startup.
>
> Verification:
> - `pnpm --filter api typecheck` — expected: green.
> - `node -e "import('./apps/api/dist/auth/auth.config.js').then(m => console.log(typeof m.buildAuthOptions))"` — expected: `function` after build.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P6-1 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P6-2 — `PrismaUserRepository` implementing `IUserRepository`

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** L
- **Depends on:** `P6-1`

### Description
Implement the 11 methods of `IUserRepository` against the Prisma `User` model. The implementation must return `AuthUser` shapes unchanged: the library always passes already-hashed `passwordHash`, already-encrypted `mfaSecret`, and already-hashed `mfaRecoveryCodes` — this repository must persist and return them verbatim, never re-hash or re-encrypt. Covers FCM row **#32 (custom user repository)**.

### Acceptance Criteria
- [ ] `apps/api/src/auth/prisma-user.repository.ts` exports `PrismaUserRepository` (`@Injectable()`) implementing `IUserRepository`.
- [ ] All 11 methods implemented: `findById`, `findByEmail`, `findByOAuthId`, `create`, `createWithOAuth`, `updatePassword`, `updateMfa`, `updateStatus`, `updateLastLogin`, `markEmailVerified`, and the remaining interface method defined in `user-repository.interface.ts`.
- [ ] `findByEmail(email, tenantId)` uses the compound unique index `(tenantId, email)`.
- [ ] `findByOAuthId(provider, providerId, tenantId)` filters by `(oauthProvider, oauthProviderId, tenantId)`.
- [ ] No method re-hashes `passwordHash`, re-encrypts `mfaSecret`, or transforms `mfaRecoveryCodes`.
- [ ] Returns are mapped to the `AuthUser` shape documented by the library's `IUserRepository` (no Prisma-only fields leaked).
- [ ] Constructor injects `PrismaService`.

### Files to create / modify
- `apps/api/src/auth/prisma-user.repository.ts` — new file.

### Agent Execution Prompt

> Role: Senior NestJS engineer familiar with `@bymax-one/nest-auth` and Prisma 6.
>
> Context: Covers FCM row **#32 (custom user repository)**. The interface to implement lives at `../nest-auth/src/server/interfaces/user-repository.interface.ts` and exports `AuthUser`, `CreateUserData`, `CreateWithOAuthData`, `IUserRepository`, `SafeAuthUser`, `UpdateMfaData`. The Prisma `User` schema was designed in Phase 4 to mirror `AuthUser` field-for-field.
>
> Objective: Implement every `IUserRepository` method on top of `PrismaService`.
>
> Steps:
> 1. `import type { IUserRepository, AuthUser, CreateUserData, CreateWithOAuthData, UpdateMfaData } from '@bymax-one/nest-auth'` — `type` imports only.
> 2. Write a private `toAuthUser(row)` mapper that returns the `AuthUser` shape with no extra fields.
> 3. Implement each method; use `prisma.user.findUnique({ where: { tenantId_email: { tenantId, email } } })` for `findByEmail`.
> 4. For `create` and `createWithOAuth`, persist `passwordHash`, `mfaSecret`, `mfaRecoveryCodes` exactly as provided.
> 5. `updateMfa` accepts `UpdateMfaData` and writes all four fields (`mfaEnabled`, `mfaSecret`, `mfaRecoveryCodes`, and any counters the interface includes) unchanged.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Never call `bcrypt`, `scrypt`, `encrypt`, or any hashing function inside this file.
> - Import interfaces as `type`.
>
> Verification:
> - `pnpm --filter api typecheck` — expected: green.
> - `pnpm --filter api test prisma-user.repository.spec` — expected: green (spec lands in Phase 17, stub is fine here).

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P6-2 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P6-3 — `PrismaPlatformUserRepository` implementing `IPlatformUserRepository`

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P6-1`

### Description
Implement `IPlatformUserRepository` against the Prisma `PlatformUser` model. Analogous to `PrismaUserRepository` but without `tenantId` scoping. Required so Phase 9 can ship platform admin login using the library's platform surface. Covers FCM row **#22 (platform admin context)** for the backing repo contract.

### Acceptance Criteria
- [ ] `apps/api/src/auth/prisma-platform-user.repository.ts` exports `PrismaPlatformUserRepository` (`@Injectable()`) implementing `IPlatformUserRepository`.
- [ ] All interface methods implemented against `prisma.platformUser`.
- [ ] No re-hashing / re-encryption of `passwordHash`, `mfaSecret`, or `mfaRecoveryCodes`.
- [ ] `findByEmail(email)` hits the unique index on `email` (no tenantId argument).
- [ ] Returns are mapped to the `AuthPlatformUser` shape from the library interface.
- [ ] Constructor injects `PrismaService`.

### Files to create / modify
- `apps/api/src/auth/prisma-platform-user.repository.ts` — new file.

### Agent Execution Prompt

> Role: Senior NestJS engineer familiar with `@bymax-one/nest-auth` and Prisma 6.
>
> Context: The interface lives at `../nest-auth/src/server/interfaces/platform-user-repository.interface.ts` and exports `AuthPlatformUser`, `IPlatformUserRepository`, `SafeAuthPlatformUser`, `UpdatePlatformMfaData`. Covers FCM row **#22** (platform backing repo).
>
> Objective: Implement every `IPlatformUserRepository` method on `prisma.platformUser`.
>
> Steps:
> 1. `import type { IPlatformUserRepository, AuthPlatformUser, UpdatePlatformMfaData } from '@bymax-one/nest-auth'`.
> 2. Mirror `PrismaUserRepository` but drop all `tenantId` arguments and filters.
> 3. Map rows through a private `toAuthPlatformUser(row)` helper.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Never hash / encrypt library-provided values.
> - Import interfaces as `type`.
>
> Verification:
> - `pnpm --filter api typecheck` — expected: green.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P6-3 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P6-4 — `MailpitEmailProvider` implementing `IEmailProvider`

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P6-1`

### Description
Implement `IEmailProvider` using `nodemailer` pointed at the local Mailpit SMTP (`localhost:1025`, no auth, no TLS). HTML templates live alongside the provider in `apps/api/src/auth/email-templates/*.html`. Every method must log the subject and recipient only — never the body. Covers FCM rows **#5 (email verification)**, **#6/#7 (password reset)**, **#15 (new-session alert)**, **#21 (invitations)**, **#31 (custom email provider)**.

### Acceptance Criteria
- [ ] `apps/api/src/auth/mailpit-email.provider.ts` exports `MailpitEmailProvider` (`@Injectable()`) implementing `IEmailProvider`.
- [ ] Uses `nodemailer.createTransport({ host, port, secure: false })`; host + port read from `ConfigService` (`SMTP_HOST`, `SMTP_PORT`).
- [ ] `from` address comes from `SMTP_FROM` env var.
- [ ] `sendVerificationEmail`, `sendPasswordResetEmail`, `sendPasswordResetOtp`, `sendNewSessionAlert`, `sendInvitationEmail` (and any other methods on `IEmailProvider`) implemented.
- [ ] Each method renders its matching template from `apps/api/src/auth/email-templates/*.html` — one file per interface method.
- [ ] Log output includes subject + recipient only; logger never receives the HTML body or any code/token.
- [ ] Handles Mailpit unreachable by logging and rethrowing (caller decides).

### Files to create / modify
- `apps/api/src/auth/mailpit-email.provider.ts` — new file.
- `apps/api/src/auth/email-templates/verify-email.html` — OTP template.
- `apps/api/src/auth/email-templates/password-reset-token.html` — link template.
- `apps/api/src/auth/email-templates/password-reset-otp.html` — OTP template.
- `apps/api/src/auth/email-templates/new-session-alert.html` — session alert.
- `apps/api/src/auth/email-templates/invitation.html` — invitation template.

### Agent Execution Prompt

> Role: Senior NestJS engineer familiar with `@bymax-one/nest-auth` and `nodemailer`.
>
> Context: The interface lives at `../nest-auth/src/server/interfaces/email-provider.interface.ts` and exports `IEmailProvider`, `InviteData`, `SessionInfo`. Covers FCM rows **#5, #6, #7, #15, #21, #31**. Mailpit runs from `docker-compose.yml` and must be used in all local dev.
>
> Objective: Implement a cleanly-logged, template-driven `MailpitEmailProvider` that satisfies `IEmailProvider`.
>
> Steps:
> 1. `import type { IEmailProvider, InviteData, SessionInfo } from '@bymax-one/nest-auth'`.
> 2. Build the transport once in the constructor using `SMTP_HOST`/`SMTP_PORT`/`SMTP_FROM`.
> 3. Implement a private `render(templateName, vars)` helper that reads the HTML file once (cached) and interpolates `{{var}}` placeholders.
> 4. Each interface method: render template → `transporter.sendMail({ to, from, subject, html })` → `logger.info({ subject, to })` only.
> 5. Never pass the plaintext code/token to `logger`.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Import the interface as `type`.
> - Do not add any third-party templating engine — simple `{{var}}` string replace is sufficient.
>
> Verification:
> - `pnpm --filter api typecheck` — expected: green.
> - With Mailpit running (`pnpm infra:up`), a unit test that calls `sendVerificationEmail('t@example.com', '123456')` followed by polling `http://localhost:8025/api/v1/messages` — expected: one captured message with subject containing "Verify".

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P6-4 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P6-5 — `ResendEmailProvider` implementing `IEmailProvider`

- **Status:** 🔴 Not Started
- **Priority:** Medium
- **Size:** M
- **Depends on:** `P6-4`

### Description
Implement a production-grade `ResendEmailProvider` using the `resend` SDK. Activated when `EMAIL_PROVIDER=resend`. Reuses the same HTML templates from `email-templates/*` as the Mailpit variant so swapping providers is a one-env-var change. Covers FCM row **#31 (custom email provider)** for the production reference.

### Acceptance Criteria
- [ ] `apps/api/src/auth/resend-email.provider.ts` exports `ResendEmailProvider` (`@Injectable()`) implementing `IEmailProvider`.
- [ ] Uses the `resend` SDK (`new Resend(apiKey)`) with `RESEND_API_KEY` from `ConfigService`.
- [ ] Renders from the same `apps/api/src/auth/email-templates/*.html` files (shared with Mailpit provider — factor the `render()` helper into a shared module if useful, otherwise duplicate minimally).
- [ ] `from` address comes from `SMTP_FROM`.
- [ ] Log output remains subject + recipient only.
- [ ] Never throws because `RESEND_API_KEY` is missing — fail fast in the constructor with a clear error message.

### Files to create / modify
- `apps/api/src/auth/resend-email.provider.ts` — new file.
- `apps/api/package.json` — add `resend` dependency (pinned).

### Agent Execution Prompt

> Role: Senior NestJS engineer familiar with `@bymax-one/nest-auth` and the Resend SDK.
>
> Context: Covers FCM row **#31**. The interface lives at `../nest-auth/src/server/interfaces/email-provider.interface.ts`. The provider must be a drop-in alternative to `MailpitEmailProvider` — identical signatures, identical templates.
>
> Objective: Implement `ResendEmailProvider` using the `resend` SDK.
>
> Steps:
> 1. `import type { IEmailProvider, InviteData, SessionInfo } from '@bymax-one/nest-auth'`.
> 2. Install `resend` and import `Resend` at runtime.
> 3. In the constructor, read `RESEND_API_KEY`; throw `new Error('RESEND_API_KEY is required when EMAIL_PROVIDER=resend')` if absent.
> 4. For each interface method: render template → `this.resend.emails.send({ from, to, subject, html })` → log subject + recipient.
> 5. Reuse the template rendering helper from P6-4 (import or duplicate).
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Import the interface as `type`.
> - Never log the Resend API key.
>
> Verification:
> - `pnpm --filter api typecheck` — expected: green.
> - With `EMAIL_PROVIDER=resend` and a test `RESEND_API_KEY`, provider instantiation succeeds; with key unset, instantiation throws the documented error.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P6-5 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P6-6 — `AppAuthHooks` implementing `IAuthHooks` (audit log)

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P6-1`

### Description
Implement `IAuthHooks` so every lifecycle event is persisted as an `AuditLog` row with a distinct `event` slug (`user.registered`, `user.login.succeeded`, `session.evicted`, `mfa.enabled`, etc.). Payloads must omit secrets (no tokens, OTPs, raw passwords). All hook bodies are non-blocking: insert failures must be logged and swallowed so auth flows never fail because of audit. Covers FCM row **#30 (audit / lifecycle hooks)**.

### Acceptance Criteria
- [ ] `apps/api/src/auth/app-auth.hooks.ts` exports `AppAuthHooks` (`@Injectable()`) implementing `IAuthHooks`.
- [ ] Every hook method on the interface is implemented.
- [ ] Each hook writes exactly one `AuditLog` row with a distinct, documented `event` slug (`user.registered`, `user.login.succeeded`, `user.login.failed`, `user.logout`, `session.evicted`, `mfa.enabled`, `mfa.disabled`, `password.reset.requested`, `password.reset.completed`, `invitation.sent`, `invitation.accepted`, `oauth.linked`, and the remainder defined on `IAuthHooks`).
- [ ] Payload JSON omits `passwordHash`, `token`, OTP codes, refresh tokens, `mfaSecret`, `mfaRecoveryCodes`.
- [ ] Insert errors are caught and logged via `nestjs-pino`; hook always resolves successfully.
- [ ] `beforeRegister` returns `{ allow: true }` unconditionally (pattern to be tested later).

### Files to create / modify
- `apps/api/src/auth/app-auth.hooks.ts` — new file.

### Agent Execution Prompt

> Role: Senior NestJS engineer familiar with `@bymax-one/nest-auth` audit/lifecycle hooks.
>
> Context: The hooks interface lives at `../nest-auth/src/server/interfaces/auth-hooks.interface.ts` and exports `BeforeRegisterResult`, `HookContext`, `IAuthHooks`, `OAuthLoginResult`. Covers FCM row **#30**. Events land in `AuditLog` (Prisma table from Phase 4).
>
> Objective: Implement `AppAuthHooks` that persists every hook invocation to `AuditLog` without leaking secrets and without breaking auth on audit failures.
>
> Steps:
> 1. `import type { IAuthHooks, BeforeRegisterResult, HookContext, OAuthLoginResult } from '@bymax-one/nest-auth'`.
> 2. Inject `PrismaService` and a `Logger`.
> 3. Write a private `record(event: string, ctx: HookContext, payload: Record<string, unknown>)` helper that `try { prisma.auditLog.create({...}) } catch (err) { logger.error(...) }`.
> 4. Map each hook to its slug; pass only non-secret fields in `payload` (ids, timestamps, provider names, status transitions).
> 5. Pull `tenantId`, `actorUserId`, `actorPlatformUserId`, `ip`, `userAgent` out of the `HookContext` argument as available.
> 6. `beforeRegister` returns `{ allow: true }` and still writes `user.register.attempted` with the (hashed) email fingerprint — not the raw email if that would be enumeration-sensitive; use `sha256` from `@bymax-one/nest-auth` if needed.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Import interfaces as `type`.
> - Never block auth on audit writes — wrap every DB call in try/catch.
> - Never log or persist tokens, OTPs, raw passwords, `mfaSecret`, or `mfaRecoveryCodes`.
>
> Verification:
> - `pnpm --filter api typecheck` — expected: green.
> - Unit test that calls each hook and asserts one `AuditLog` row with the expected `event` slug (full spec arrives in Phase 17).

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P6-6 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## Completion log
