# nest-auth-example — Project Overview

> **Reference implementation for [`@bymax-one/nest-auth`](https://github.com/bymaxone/nest-auth)** — a full-stack authentication and authorization package for NestJS, React and Next.js.
>
> Maintained by **[Bymax One](https://bymax.one)** • MIT License

---

## 1. Purpose

`nest-auth-example` is the **canonical reference application** for the `@bymax-one/nest-auth` package. It exists to show — end to end, with no shortcuts — how to build a production-grade authentication system on top of the library.

It is simultaneously:

- A **runnable demo** — `git clone`, `docker compose up`, and you have a working multi-tenant SaaS auth server with a Next.js dashboard.
- A **knowledge base** — every feature of the library is exercised and documented in context, so consumers can copy proven patterns into their own apps.
- A **living test harness** — used by the library maintainers to validate that public APIs behave as documented before each release.

If a feature is documented in the library README but is _not_ demonstrated in this repository, that is considered a documentation gap and tracked as an issue.

---

## 2. Goals & Non-Goals

### Goals

1. **Demonstrate every public feature** of `@bymax-one/nest-auth` in a realistic, runnable context (see §6 — Feature Coverage Matrix).
2. **Mirror real-world production setup** — Docker-based local stack with PostgreSQL and Redis, environment-variable configuration, structured logging, and HTTP-only cookies served over HTTPS-ready transports.
3. **Stay copy-paste friendly** — folder names, module organization, repository implementations, and frontend patterns are intentionally generic so users can lift them directly.
4. **Be approachable for first-time users** — sensible defaults, seeded demo data, and a guided "first 5 minutes" walkthrough.
5. **Stay current with the library** — pinned to a specific `@bymax-one/nest-auth` version per release, with upgrade notes.

### Non-Goals

- **It is not a starter template.** Use `create-bymax-app` (planned, separate repository) for that. This repo prioritizes completeness over minimalism.
- **It is not a UI kit.** The frontend uses [shadcn/ui](https://ui.shadcn.com) + Tailwind because they are widely adopted, not because they are the only supported choice.
- **It is not a CMS, billing, or admin platform.** It only demonstrates authentication, authorization, and user/tenant management.
- **It does not maintain backwards compatibility across library major versions.** Each major version of the library will have its own branch in this repository.

---

## 3. Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser (User Agent)                        │
│                                                                     │
│  HttpOnly cookies: access_token, refresh_token, has_session         │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ HTTPS
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Next.js 16 (apps/web)                                              │
│  ─────────────────────                                              │
│  • App Router pages & server components                             │
│  • Edge proxy (createAuthProxy) → cookie/role gating                │
│  • API route handlers:                                              │
│      /api/auth/silent-refresh  (createSilentRefreshHandler)         │
│      /api/auth/client-refresh  (createClientRefreshHandler)         │
│      /api/auth/logout          (createLogoutHandler)                │
│  • React: <AuthProvider> + useSession / useAuth / useAuthStatus     │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ JSON over HTTP (same-origin via proxy)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  NestJS 11 (apps/api)                                               │
│  ────────────────                                                   │
│  • BymaxAuthModule.registerAsync({ ... })                           │
│      ├─ JWT (access + refresh, rotation, revocation)                │
│      ├─ MFA (TOTP + recovery codes)                                 │
│      ├─ OAuth (Google plugin)                                       │
│      ├─ Sessions (Redis-backed, FIFO eviction)                      │
│      ├─ Password reset (token + OTP modes)                          │
│      ├─ Email verification (OTP)                                    │
│      ├─ Invitations                                                 │
│      ├─ Platform admin context                                      │
│      └─ Brute-force protection + @nestjs/throttler                  │
│  • PrismaUserRepository    implements IUserRepository               │
│  • PrismaPlatformUserRepo  implements IPlatformUserRepository       │
│  • MailpitEmailProvider    implements IEmailProvider                │
│  • AppAuthHooks            implements IAuthHooks                    │
└──────┬─────────────────────────────────────┬────────────────────────┘
       │                                     │
       ▼                                     ▼
┌─────────────────┐                 ┌────────────────────┐
│   PostgreSQL    │                 │       Redis        │
│   (port 5432)   │                 │    (port 6379)     │
│                 │                 │                    │
│ users           │                 │ sessions, brute-   │
│ platform_users  │                 │ force counters,    │
│ invitations     │                 │ OTPs, password-    │
│ refresh_tokens  │                 │ reset tokens, JWT  │
│ audit_logs      │                 │ revocation list    │
└─────────────────┘                 └────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Mailpit (dev only, port 8025) — captures all outgoing emails       │
│  https://mailpit.axllent.org/                                       │
└─────────────────────────────────────────────────────────────────────┘
```

The `apps/api` and `apps/web` services are independently deployable; they communicate over JSON HTTP with all session state carried in HttpOnly cookies. No shared in-process state.

---

## 4. Tech Stack

| Layer             | Technology                | Version  | Why                                                     |
| ----------------- | ------------------------- | -------- | ------------------------------------------------------- |
| Auth library      | `@bymax-one/nest-auth`    | `^1.0.0` | The library this project demonstrates                   |
| Backend runtime   | Node.js                   | `>=24`   | Library requirement                                     |
| Backend framework | NestJS                    | `^11.0`  | Library peer dependency                                 |
| HTTP adapter      | Express                   | `^5.0`   | Default adapter; required by library                    |
| Database          | PostgreSQL                | `18`     | Most common choice for SaaS workloads                   |
| Cache / sessions  | Redis                     | `7`      | Library peer dependency (`ioredis`)                     |
| ORM               | Prisma                    | `^6.0`   | Type-safe, popular in NestJS ecosystem                  |
| Email (dev)       | Mailpit                   | `latest` | Local SMTP capture for testing flows                    |
| Email (prod)      | Resend (example provider) | `^4.0`   | Pluggable — swap with any `IEmailProvider`              |
| Frontend          | Next.js                   | `^16.0`  | Library peer dependency; demonstrates `/nextjs` subpath |
| UI framework      | React                     | `^19.0`  | Library peer dependency; demonstrates `/react` subpath  |
| Styling           | Tailwind CSS + shadcn/ui  | latest   | De facto modern default                                 |
| Form / validation | react-hook-form + zod     | latest   | Idiomatic for App Router                                |
| Package manager   | pnpm                      | `^10.8`  | Matches library; first-class workspace support          |
| Container runtime | Docker Compose            | v2       | Single-command local stack                              |
| Testing (api)     | Jest + supertest          | latest   | NestJS standard                                         |
| Testing (web)     | Vitest + Playwright       | latest   | Vitest for unit, Playwright for end-to-end              |

---

## 5. Repository Layout

```
nest-auth-example/
├── apps/
│   ├── api/                          # NestJS backend
│   │   ├── prisma/
│   │   │   ├── schema.prisma         # User, PlatformUser, Invitation, AuditLog
│   │   │   ├── migrations/
│   │   │   └── seed.ts               # Demo tenants + users
│   │   ├── src/
│   │   │   ├── auth/                 # Library wiring (BymaxAuthModule.registerAsync)
│   │   │   │   ├── auth.config.ts    # ResolvedOptions factory from env
│   │   │   │   ├── prisma-user.repository.ts        # implements IUserRepository
│   │   │   │   ├── prisma-platform-user.repository.ts
│   │   │   │   ├── mailpit-email.provider.ts        # implements IEmailProvider
│   │   │   │   ├── resend-email.provider.ts         # production reference
│   │   │   │   └── app-auth.hooks.ts                # implements IAuthHooks (audit log)
│   │   │   ├── tenants/              # Example feature module — tenant CRUD, gated
│   │   │   ├── projects/             # Example feature module — uses @Roles, @CurrentUser
│   │   │   ├── platform/             # Platform admin example endpoints
│   │   │   ├── health/
│   │   │   ├── prisma/
│   │   │   ├── redis/
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   ├── test/                     # supertest e2e
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                          # Next.js 16 frontend
│       ├── app/
│       │   ├── (auth)/               # public auth pages
│       │   │   ├── login/
│       │   │   ├── register/
│       │   │   ├── forgot-password/
│       │   │   ├── reset-password/
│       │   │   ├── verify-email/
│       │   │   ├── mfa-challenge/
│       │   │   └── accept-invitation/
│       │   ├── dashboard/            # protected; uses useSession()
│       │   │   ├── account/          # profile, password change
│       │   │   ├── security/         # MFA setup, recovery codes
│       │   │   ├── sessions/         # active sessions list / revoke
│       │   │   ├── invitations/      # admin invites
│       │   │   └── team/             # tenant members + roles
│       │   ├── platform/             # platform-admin-only area
│       │   ├── api/auth/
│       │   │   ├── silent-refresh/route.ts
│       │   │   ├── client-refresh/route.ts
│       │   │   └── logout/route.ts
│       │   ├── layout.tsx            # wraps with <AuthProvider>
│       │   └── page.tsx              # landing
│       ├── proxy.ts                  # createAuthProxy()
│       ├── lib/
│       │   ├── auth-client.ts        # createAuthClient()
│       │   └── env.ts
│       ├── components/
│       │   ├── auth/                 # forms, MFA QR, OTP input
│       │   └── ui/                   # shadcn primitives
│       ├── package.json
│       └── tsconfig.json
│
├── docker/
│   ├── postgres/
│   │   └── init.sql                  # CREATE DATABASE example_app;
│   └── redis/
│       └── redis.conf
│
├── docs/
│   ├── OVERVIEW.md                   # ← you are here
│   ├── GETTING_STARTED.md            # 5-minute quickstart
│   ├── FEATURES.md                   # tour of each demonstrated feature
│   ├── ARCHITECTURE.md               # deeper dive into module boundaries
│   ├── ENVIRONMENT.md                # full env-var reference
│   ├── DATABASE.md                   # schema rationale + migration strategy
│   ├── REDIS.md                      # key namespaces + TTLs in this app
│   ├── EMAIL.md                      # how to swap providers
│   ├── DEPLOYMENT.md                 # production checklist
│   ├── TROUBLESHOOTING.md
│   └── RELEASES.md                   # which lib version each branch tracks
│
├── docker-compose.yml                # postgres, redis, mailpit
├── docker-compose.override.yml       # dev hot-reload (gitignored on prod)
├── .env.example
├── package.json                      # workspace root
├── pnpm-workspace.yaml
├── README.md
├── LICENSE                           # MIT
└── CHANGELOG.md
```

---

## 6. Feature Coverage Matrix

Every row maps to a feature exposed by `@bymax-one/nest-auth`. Each one is exercised in this repository.

| #   | Library Feature                                  | Library Surface                                            | Demonstrated in                                                               |
| --- | ------------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Email + password registration                    | `POST /auth/register`, `RegisterDto`                       | `app/(auth)/register` → `apps/api` `BymaxAuthModule`                          |
| 2   | Login (cookie-mode)                              | `POST /auth/login`                                         | `app/(auth)/login` + `<AuthProvider>` cookie handshake                        |
| 3   | JWT access + refresh rotation                    | `tokenDelivery: 'cookie'`, refresh grace window            | Silent refresh route handler in `app/api/auth/silent-refresh`                 |
| 4   | JWT revocation (Redis JTI blacklist)             | `TokenManagerService`                                      | `Sign out everywhere` action in `dashboard/sessions`                          |
| 5   | Email verification (OTP)                         | `controllers.passwordReset`, `emailVerification: required` | `app/(auth)/verify-email` flow + Mailpit capture                              |
| 6   | Password reset — token mode                      | `passwordReset.method: 'token'`                            | `app/(auth)/forgot-password` + `app/(auth)/reset-password?token=…`            |
| 7   | Password reset — OTP mode                        | `passwordReset.method: 'otp'`                              | `?mode=otp` variant of the same pages, backed by separate API instance config |
| 8   | TOTP MFA enrollment + QR                         | `MfaService.setup`, `POST /auth/mfa/setup`                 | `dashboard/security` page renders QR, accepts confirmation                    |
| 9   | TOTP MFA challenge on login                      | `MfaChallengeDto`, `MfaRequiredGuard`                      | `app/(auth)/mfa-challenge` redirect path                                      |
| 10  | MFA recovery codes (download + use)              | `mfa.recoveryCodeCount`                                    | Modal in `dashboard/security`; usable in challenge page                       |
| 11  | MFA disable                                      | `MfaDisableDto`                                            | Action in `dashboard/security`                                                |
| 12  | OAuth (Google) sign-in & link                    | `controllers.oauth: true`, `GoogleOAuthPlugin`             | "Continue with Google" button on login + register pages                       |
| 13  | Active sessions listing + revoke                 | `controllers.sessions: true`, `GET/DELETE /auth/sessions`  | `dashboard/sessions` page                                                     |
| 14  | Session limit + FIFO eviction                    | `sessions.defaultMaxSessions`                              | Limit displayed; e2e test asserts oldest evicted                              |
| 15  | New-session email alerts                         | `IEmailProvider.sendNewSessionAlert`                       | Captured in Mailpit on each fresh login                                       |
| 16  | Brute-force protection                           | `bruteForce.maxAttempts`                                   | Login page surfaces `ACCOUNT_LOCKED`; demo button to trigger                  |
| 17  | Per-route throttling                             | `AUTH_THROTTLE_CONFIGS` + `@nestjs/throttler`              | Wired in `app.module.ts`; `/health/throttle-demo` shows behavior              |
| 18  | RBAC with hierarchy                              | `roles.hierarchy`, `@Roles`, `RolesGuard`                  | `apps/api/src/projects` and frontend role-gated nav                           |
| 19  | `@CurrentUser`, `@Public`, `@SkipMfa` decorators | server decorators                                          | Used throughout `apps/api/src/projects` and `tenants`                         |
| 20  | Multi-tenant isolation                           | `tenantIdResolver`, `tenantId` on every entity             | `X-Tenant-Id` header, tenant switcher in dashboard                            |
| 21  | User invitations                                 | `controllers.invitations: true`                            | `dashboard/invitations` (admin) → `accept-invitation` (recipient)             |
| 22  | Platform admin context                           | `controllers.platform: true`, `JwtPlatformGuard`           | Separate `/platform` area with its own login                                  |
| 23  | Account status enforcement                       | `UserStatusGuard`, `blockedStatuses`                       | Demo page lets admin toggle a user to `suspended`; login blocked              |
| 24  | WebSocket auth                                   | `WsJwtGuard`                                               | `apps/api/src/notifications` gateway + dashboard toast                        |
| 25  | `useSession` / `useAuth` / `useAuthStatus`       | `@bymax-one/nest-auth/react`                               | All client components in `apps/web`                                           |
| 26  | Edge proxy gating                                | `createAuthProxy`                                          | `apps/web/proxy.ts`                                                           |
| 27  | Silent + client refresh handlers                 | `createSilentRefreshHandler`, `createClientRefreshHandler` | `app/api/auth/*` route handlers                                               |
| 28  | Logout handler                                   | `createLogoutHandler`                                      | `app/api/auth/logout/route.ts`                                                |
| 29  | Shared error codes (anti-enumeration)            | `AUTH_ERROR_CODES`                                         | All auth forms surface user-facing messages from this map                     |
| 30  | Audit / lifecycle hooks                          | `IAuthHooks`                                               | `AppAuthHooks` writes to `audit_logs` table                                   |
| 31  | Custom email provider                            | `IEmailProvider`                                           | `MailpitEmailProvider` (dev) and `ResendEmailProvider` (prod reference)       |
| 32  | Custom user repository                           | `IUserRepository`                                          | `PrismaUserRepository`                                                        |

> **Coverage rule:** every public export from `@bymax-one/nest-auth` (server, shared, client, react, nextjs subpaths) is referenced from at least one file in this repository. CI runs an export-usage check to enforce this.

---

## 7. Library Linking (Local Development)

This project is the **first known consumer** of `@bymax-one/nest-auth`. Until the package is published to npm, it is consumed via [`pnpm link`](https://pnpm.io/cli/link) from the sibling checkout.

Expected layout on disk:

```
~/projects/
├── nest-auth/             # the library — built before linking
└── nest-auth-example/     # this repository
```

### One-time setup

```bash
# 1. Build the library
cd ../nest-auth
pnpm install
pnpm build

# 2. Register it as a global link
pnpm link --global

# 3. Consume it from this project
cd ../nest-auth-example
pnpm install
pnpm link --global @bymax-one/nest-auth
```

### Day-to-day workflow

When iterating on the library itself, run `pnpm build --watch` (or `pnpm dev`) inside `nest-auth/` so the linked `dist/` is always fresh. The example app picks up changes on the next request (NestJS hot-reload via `nest start --watch`; Next.js Fast Refresh for the web side).

### When the package is published

Once `@bymax-one/nest-auth` ships to the npm registry, `pnpm link` is replaced by a normal version-pinned dependency in `apps/api/package.json` and `apps/web/package.json`. The linking instructions remain in this repository for contributors who want to develop both side by side.

A `scripts/link-library.sh` helper automates the linking dance. See `docs/GETTING_STARTED.md` for details.

---

## 8. Local Stack (Docker Compose)

A single `docker compose up` brings up everything except the apps themselves (which run on the host for fast hot-reload):

| Service    | Image                    | Host port                  | Purpose                                                       |
| ---------- | ------------------------ | -------------------------- | ------------------------------------------------------------- |
| `postgres` | `postgres:18-alpine`     | `5432`                     | Primary database; volume-persisted                            |
| `redis`    | `redis:7-alpine`         | `6379`                     | Sessions, brute-force counters, OTPs, JWT blacklist           |
| `mailpit`  | `axllent/mailpit:latest` | `1025` (SMTP), `8025` (UI) | Captures all outbound emails; web UI at http://localhost:8025 |

A `--profile full` override can additionally containerize `apps/api` and `apps/web` for parity testing with production builds.

---

## 9. Configuration

All runtime configuration is environment-variable driven. `apps/api` and `apps/web` each have their own `.env`, with a single `.env.example` at the repo root listing every variable used across the stack.

The most important groups:

- **`JWT_SECRET`** — at least 32 chars, generated with `openssl rand -hex 64`.
- **`MFA_ENCRYPTION_KEY`** — base64-encoded 32 bytes, generated with `openssl rand -base64 32`.
- **`DATABASE_URL`** — Prisma connection string.
- **`REDIS_URL`** — `ioredis` connection string.
- **`OAUTH_GOOGLE_CLIENT_ID` / `OAUTH_GOOGLE_CLIENT_SECRET`** — optional; OAuth controller is only registered when both are set.
- **`EMAIL_PROVIDER`** — `mailpit` (default) or `resend`. Switches which `IEmailProvider` is bound.
- **`AUTH_ROUTE_PREFIX`** — default `auth`; documented because it changes URLs the frontend hits.

The full reference, including defaults and validation rules, lives in `docs/ENVIRONMENT.md`.

---

## 10. Database Schema (Prisma)

Six tables, all `tenantId`-scoped where applicable:

- **`users`** — fields exactly mirror `IUserRepository`'s expected shape: `id`, `tenantId`, `email`, `name`, `passwordHash`, `role`, `status`, `emailVerified`, `mfaEnabled`, `mfaSecret` (encrypted at rest by the library), `mfaRecoveryCodes` (hashed by the library), `oauthProvider`, `oauthProviderId`, `lastLoginAt`, timestamps.
- **`platform_users`** — analogous, no `tenantId`. Backs the platform admin context.
- **`tenants`** — owned by this example app, not the library. Demonstrates how a real app correlates its own data with the library's tenant id.
- **`invitations`** — token, role, expiresAt, acceptedAt.
- **`audit_logs`** — every event emitted via `IAuthHooks` is persisted here.
- **`projects`** — toy domain table to show RBAC and tenant scoping in action.

`passwordHash`, `mfaSecret`, and `mfaRecoveryCodes` are stored exactly as the library returns them. The example never re-hashes or transforms these values.

---

## 11. Redis Key Namespaces

The library prefixes every key with `redisNamespace` (default `bymax-auth`). This example sets it to `nest-auth-example` so multiple projects can share the same Redis instance without collisions. Notable keys:

| Pattern                                       | Purpose                             | Owner        |
| --------------------------------------------- | ----------------------------------- | ------------ |
| `nest-auth-example:sess:{userId}`             | Active session hash set             | Library      |
| `nest-auth-example:sd:{sessionHash}`          | Session detail (device, ip, ts)     | Library      |
| `nest-auth-example:lf:{sha256(tenant+email)}` | Brute-force failure counter         | Library      |
| `nest-auth-example:rt:{sha256(refreshToken)}` | Active refresh tokens               | Library      |
| `nest-auth-example:rev:{jti}`                 | JWT revocation blacklist            | Library      |
| `nest-auth-example:otp:{purpose}:{key}`       | OTPs (verification, password reset) | Library      |
| `nest-auth-example:inv:{token}`               | Invitation tokens                   | Library      |
| `nest-auth-example:app:notify:{userId}`       | App-owned notification fan-out      | This example |

Detailed lifetimes are documented in `docs/REDIS.md`.

---

## 12. Demonstrated User Journeys

`docs/FEATURES.md` walks through each of these end to end with screenshots and the relevant library API calls:

1. **First-time signup** → email verification → first login.
2. **Login with brute-force lockout** → unlock window expires → retry succeeds.
3. **MFA enrollment** with Google Authenticator → re-login with TOTP challenge → use a recovery code.
4. **Password reset** in both modes (token link and OTP).
5. **OAuth sign-in with Google**, including account linking with an existing email.
6. **Invitation flow** — admin invites a teammate, recipient accepts, role applied.
7. **Active sessions** — multi-device login → list → revoke a single session → revoke all.
8. **Tenant switching** — a user belonging to two tenants picks one; data isolation verified.
9. **Platform admin** — separate login portal, separate JWT context, no leakage to dashboard tokens.
10. **Account status** — admin suspends a user; user is locked out on next request.

---

## 13. Testing Strategy

| Layer      | Tool       | Scope                                                                  |
| ---------- | ---------- | ---------------------------------------------------------------------- |
| `apps/api` | Jest       | Repository implementations, hooks, custom guards/decorators            |
| `apps/api` | supertest  | End-to-end auth flows against a real Postgres + Redis (testcontainers) |
| `apps/web` | Vitest     | Pure utility/component tests                                           |
| `apps/web` | Playwright | Full user-journey tests across the stack                               |

CI runs the full matrix on every PR; e2e suites use `docker compose -f docker-compose.test.yml` for ephemeral infra.

---

## 14. Deployment Notes

The example targets a "two-service" deployment topology:

- `apps/api` → any Node 24 host or container platform (Fly.io, Railway, AWS ECS, Kubernetes).
- `apps/web` → Vercel, Netlify, or self-hosted Node.

Production checklist (full version in `docs/DEPLOYMENT.md`):

- Serve both services under the **same registrable domain** so cookies travel correctly. Use a domain function for `cookies.resolveDomains` if you need cross-subdomain.
- Set `cookies.secure: true`, `sameSite: 'lax'` (or `'strict'` if you do not need OAuth callback POST).
- Rotate `JWT_SECRET` on a schedule; the library supports rolling secrets via `jwt.previousSecrets`.
- Provision Redis with persistence (`appendonly yes`); session loss = forced logouts but no data loss.
- Switch `EMAIL_PROVIDER=resend` and configure DNS records (SPF, DKIM, DMARC) for your sender domain.
- Enable structured logging and ship `audit_logs` to your SIEM of choice.

---

## 15. Versioning & Release Tracking

Each major version of `@bymax-one/nest-auth` gets a long-lived branch in this repository:

| Branch | Tracks library version | Notes                                |
| ------ | ---------------------- | ------------------------------------ |
| `main` | `^1.0.0`               | Current stable                       |
| `next` | `^2.0.0` (when out)    | Pre-release; expect breaking changes |

Every commit on `main` is tagged with the exact library version it was tested against in `docs/RELEASES.md`.

---

## 16. Contributing

Issues and PRs are welcome. Because this is a reference application, the bar for changes is "does this make the demonstration of `@bymax-one/nest-auth` clearer or more complete?" — generic refactors that obscure library usage will be declined.

See `CONTRIBUTING.md` (to be added) for the full process.

---

## 17. License & Attribution

- **Code:** MIT — © Bymax One.
- **Library:** `@bymax-one/nest-auth` — MIT — © Bymax One.
- **Third-party assets:** see `THIRD_PARTY_NOTICES.md`.

---

## 18. Status

> **Document version:** 1.0 — initial draft.
> **Library version targeted:** `@bymax-one/nest-auth@1.0.0`.
> **Project status:** scaffolding in progress. Track open work in [GitHub Issues](https://github.com/bymaxone/nest-auth-example/issues).
