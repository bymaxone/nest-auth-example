<p align="center">
  <img src="https://img.shields.io/badge/%40bymax--one-nest--auth--example-000000?style=for-the-badge&logo=nestjs&logoColor=E0234E" alt="nest-auth-example" />
</p>

<h1 align="center">nest-auth-example</h1>

<p align="center">
  <strong>Reference application for <a href="https://www.npmjs.com/package/@bymax-one/nest-auth"><code>@bymax-one/nest-auth</code></a></strong><br />
  <sub>NestJS 11 · Next.js 16 · React 19 · Prisma 7 · PostgreSQL 18 · Redis 7 · Multi-Tenant SaaS Ready</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bymax-one/nest-auth"><img src="https://img.shields.io/npm/v/@bymax-one/nest-auth?style=flat-square&colorA=000000&colorB=000000&label=lib" alt="library version" /></a>
  <a href="https://github.com/bymaxone/nest-auth-example/blob/main/LICENSE"><img src="https://img.shields.io/github/license/bymaxone/nest-auth-example?style=flat-square&colorA=000000&colorB=000000" alt="license" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript strict" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-24%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 24+" /></a>
  <a href="https://nestjs.com/"><img src="https://img.shields.io/badge/NestJS-11-E0234E?style=flat-square&logo=nestjs&logoColor=white" alt="NestJS 11" /></a>
  <a href="https://nextjs.org/"><img src="https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js&logoColor=white" alt="Next.js 16" /></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 19" /></a>
  <a href="https://www.prisma.io/"><img src="https://img.shields.io/badge/Prisma-7-2D3748?style=flat-square&logo=prisma&logoColor=white" alt="Prisma 7" /></a>
  <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/Tailwind-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind 4" /></a>
</p>

<p align="center">
  <a href="https://github.com/bymaxone/nest-auth">📦 Library</a> ·
  <a href="#-quick-start">🚀 Quick Start</a> ·
  <a href="#-feature-coverage">✅ Features</a> ·
  <a href="#-architecture">🏗️ Architecture</a> ·
  <a href="docs/OVERVIEW.md">📖 Docs</a>
</p>

---

## ✨ Overview

`nest-auth-example` is the **canonical reference implementation** of [`@bymax-one/nest-auth`](https://www.npmjs.com/package/@bymax-one/nest-auth) — the full-stack authentication library for NestJS, React & Next.js. Every feature the library ships is wired up end-to-end here, in a realistic, production-grade layout you can copy-paste into your own SaaS.

If the library is **what** to use, this repository is **how** to use it.

### Why this repo exists

- **🎯 Live demo of every library feature** — registration, login, JWT refresh rotation, MFA (TOTP + recovery codes), Google OAuth, sessions with FIFO eviction, password reset (token & OTP modes), email verification, invitations, RBAC, multi-tenant isolation, platform admin context, brute-force lockout, WebSocket auth — all wired and runnable in under five minutes.
- **🧱 Copy-paste friendly** — module organization, repository implementations (Prisma), email providers (Mailpit / Resend), proxy & route handlers (Next.js App Router), React hook usage. The folder names are deliberately generic so you can lift them directly into your codebase.
- **🧪 Production-grade test harness** — 75 unit/integration suites (755 tests) + 26 API e2e suites (83 tests) + 23 Playwright specs (23 passing, no skips). Used by the library's maintainers to gate releases.
- **🔄 Always tracking latest** — `main` is pinned to the latest `@bymax-one/nest-auth` minor; when the library ships a new release, this repo is updated alongside.

```bash
git clone https://github.com/bymaxone/nest-auth-example.git
cd nest-auth-example
pnpm install && pnpm infra:up && pnpm dev
```

> **Coverage rule:** every public export from `@bymax-one/nest-auth` (server, shared, client, react, nextjs subpaths) is referenced from at least one file in this repository. See the [Feature Coverage Matrix](docs/OVERVIEW.md#6-feature-coverage-matrix) — 32/32 features green.

---

## 🔥 What's inside

### 🔐 Auth flows (`apps/web` UI + `apps/api` backend)

- ✅ **Register · Login · Logout** — email/password with cookie-mode token delivery, anti-enumeration error shaping
- ✅ **Email verification (OTP)** — 6-digit codes, cooldown timer, Mailpit-captured email
- ✅ **Password reset** — both `token` (link in email) and `otp` (6-digit code) modes, same UI
- ✅ **JWT refresh rotation** — silent iframe refresh + client-triggered refresh, grace window for concurrency
- ✅ **MFA enrollment** — QR code render via `qrcode`, recovery codes generation + download
- ✅ **MFA challenge on login** — TOTP **and** recovery-code paths, temp token in `sessionStorage` (never cookie)
- ✅ **Google OAuth** — "Continue with Google" wired to the library's plugin; account linking on existing emails
- ✅ **Brute-force lockout** — Redis atomic counters; surfaced via `AUTH_ERROR_CODES.ACCOUNT_LOCKED`
- ✅ **Session management** — list active devices, revoke one, revoke all; FIFO eviction at session limit; new-session alert email
- ✅ **WebSocket notifications** — `ws://` channel authenticated via Bearer token + Redis JTI revocation check, with tenant isolation

### 🏢 Multi-tenant + RBAC

- ✅ **Tenant isolation** — every row carries `tenantId`; `X-Tenant-Id` header resolved server-side; slug→CUID resolver for the UI
- ✅ **Hierarchical roles** — `OWNER > ADMIN > MEMBER > VIEWER`, enforced via `@Roles()` decorator + `RolesGuard`
- ✅ **Workspace switcher** — Slack-style: same email in multiple tenants? Pick a workspace from the dropdown and the app logs you out and redirects you to the destination tenant's login — one JWT per tenant, never a live context swap
- ✅ **User invitations** — admin invites by email + role; recipient flow consumes the token and sets a password
- ✅ **Account status enforcement** — `UserStatusGuard` blocks `suspended` users; admin UI toggles the flag

### 🛡️ Platform admin

- ✅ **Separate JWT context** — `JwtPlatformGuard` rejects dashboard tokens; bearer-only delivery via `sessionStorage`
- ✅ **Tenant management** — list tenants, drill into users per tenant
- ✅ **User suspension** — flip an entire tenant's user to `suspended` / `active`; self-suspension is blocked at the UI

### 🎨 UI

- ✅ **Dark glass-morphism design system** — Tailwind 4 + custom tokens + shadcn/ui primitives
- ✅ **React Hook Form + Zod** — every form validates at the boundary; library-shipped error codes are translated for the user
- ✅ **Sonner toasts + inline errors** — recoverable issues bubble as toasts; unrecoverable ones (expired invitation, broken link) stay inline
- ✅ **WS toast notifications** — `<NotificationListener>` consumes the gateway and renders ephemeral toasts

```
🌐 Browser (Chromium/Firefox/Safari)
   │  HttpOnly cookies + sessionStorage bearer (platform only)
   ▼
🎨 Next.js 16 (apps/web) — App Router, Turbopack
   │  · createAuthProxy (proxy.ts)
   │  · createSilentRefreshHandler / createClientRefreshHandler / createLogoutHandler
   │  · <AuthProvider> + useSession / useAuth / useAuthStatus
   ▼  same-origin /api/* rewrite
🚀 NestJS 11 (apps/api) — Express 5
   │  BymaxAuthModule.registerAsync({ jwt, mfa, oauth, sessions, … })
   │  · PrismaUserRepository       implements IUserRepository
   │  · PrismaPlatformUserRepository
   │  · MailpitEmailProvider / ResendEmailProvider  implements IEmailProvider
   │  · AppAuthHooks                implements IAuthHooks (audit log writer)
   ▼
🐘 PostgreSQL 18 + 🔴 Redis 7 + 📬 Mailpit (dev)
```

---

## 🚀 Quick Start

### Prerequisites

| Tool               | Version   | Notes                                       |
| ------------------ | --------- | ------------------------------------------- |
| **Node.js**        | `>= 24`   | `.nvmrc` pins it — `nvm use` is enough      |
| **pnpm**           | `>= 10.8` | `npm install -g pnpm@latest`                |
| **Docker Compose** | `v2`      | `docker compose version` should report v2.x |

That's it — no sibling library checkout, no global links, no other system dependencies. The library is consumed from npm.

### 1. Clone & install

```bash
git clone https://github.com/bymaxone/nest-auth-example.git
cd nest-auth-example
pnpm install
```

### 2. Bring up infrastructure

```bash
pnpm infra:up   # postgres:5432 + redis:6379 + mailpit:8025 (UI) / 1025 (SMTP)
```

### 3. Configure secrets

```bash
cp .env.example apps/api/.env
# Generate the two secrets the lib refuses to start without:
echo "JWT_SECRET=$(openssl rand -hex 64)"            >> apps/api/.env
echo "MFA_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> apps/api/.env
```

> [!IMPORTANT]
> `apps/web/.env.local` must declare `AUTH_JWT_SECRET_FOR_PROXY` with the **same value** as `JWT_SECRET` — the Next.js proxy decodes the cookie locally so it can role-gate without round-tripping the API.

### 4. Migrate + seed

```bash
pnpm --filter @nest-auth-example/api prisma:migrate   # apply Prisma migrations
pnpm --filter @nest-auth-example/api prisma:seed      # 2 tenants, 8 tenant users, 1 platform admin
```

### 5. Run the stack

```bash
pnpm dev   # boots api (:4000) + web (:3000) in parallel
```

| Endpoint                                           | What it serves                                         |
| -------------------------------------------------- | ------------------------------------------------------ |
| **http://localhost:3000**                          | Next.js web app                                        |
| **http://localhost:3000/auth/login?tenantId=acme** | Login page for the `acme` tenant                       |
| **http://localhost:3000/platform/login**           | Platform admin login (separate context)                |
| **http://localhost:4000/api/health**               | API health probe — `postgres`, `redis`, `library` `ok` |
| **http://localhost:8025**                          | Mailpit UI — every dev email lands here                |

### 6. Sign in

> **Dev credentials only — never reuse outside local development.**

| Login                      | Tenant   | Role        | Password            |
| -------------------------- | -------- | ----------- | ------------------- |
| `owner.acme@example.com`   | `acme`   | OWNER       | `Passw0rd!Passw0rd` |
| `admin.acme@example.com`   | `acme`   | ADMIN       | `Passw0rd!Passw0rd` |
| `admin.globex@example.com` | `globex` | ADMIN       | `Passw0rd!Passw0rd` |
| `platform@example.dev`     | —        | SUPER_ADMIN | `PlatformPassw0rd!` |

The seed prints all credentials in a banner — read it on first `prisma:seed`.

➡ **Full walk-through:** [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)

---

## ✅ Feature Coverage

Every `@bymax-one/nest-auth` capability is exercised. Each row links to the spec that locks the behavior.

### 🔐 Core authentication

| Library feature                         | Demonstrated in                                          | Tested by                                                                         |
| --------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Register + email verification (OTP)     | `app/auth/register` · `app/auth/verify-email`            | `apps/api/test/register-and-verify.e2e-spec.ts`                                   |
| Login (cookie mode) + logout            | `app/auth/login` · `<AuthProvider>`                      | `apps/api/test/login-and-logout.e2e-spec.ts` · `apps/web/e2e/login-happy.spec.ts` |
| JWT access + refresh rotation           | `app/api/auth/silent-refresh` · `client-refresh`         | `apps/api/test/refresh-rotation.e2e-spec.ts`                                      |
| JWT revocation (Redis JTI blacklist)    | "Sign out everywhere" in `dashboard/sessions`            | `apps/api/test/jwt-revocation.e2e-spec.ts`                                        |
| Password reset — token mode             | `app/auth/forgot-password` → `reset-password?mode=token` | `apps/api/test/password-reset-token.e2e-spec.ts`                                  |
| Password reset — OTP mode               | Same UI with `?mode=otp`                                 | `apps/api/test/password-reset-otp.e2e-spec.ts`                                    |
| Wrong-password + anti-enumeration shape | `app/auth/login` error mapping                           | `apps/web/e2e/login-wrong-password.spec.ts`                                       |

### 🔒 MFA & OAuth

| Library feature                       | Demonstrated in                            | Tested by                                               |
| ------------------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| TOTP enrollment + QR + recovery codes | `dashboard/security`                       | `apps/api/test/mfa-setup-challenge-disable.e2e-spec.ts` |
| TOTP challenge on login               | `app/auth/mfa-challenge`                   | `apps/web/e2e/mfa-enroll-and-login.spec.ts`             |
| Recovery code consumption             | Same challenge page, recovery-code tab     | `apps/api/test/recovery-codes.e2e-spec.ts`              |
| MFA disable                           | `dashboard/security`                       | `apps/api/test/mfa-setup-challenge-disable.e2e-spec.ts` |
| Google OAuth sign-in + linking        | "Continue with Google" on login + register | `apps/api/test/oauth-link.e2e-spec.ts`                  |

### 🏢 Multi-tenant & RBAC

| Library feature                          | Demonstrated in                                    | Tested by                                                                                         |
| ---------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Tenant isolation via `X-Tenant-Id`       | `tenantAwareFetch` + every API call                | `apps/api/test/tenant-isolation.e2e-spec.ts`                                                      |
| Workspace switcher (Slack-style re-auth) | `<TenantSwitcher>` + `GET /api/account/workspaces` | `apps/web/e2e/tenant-switcher.spec.ts` (logs out then redirects to `/auth/login?tenantId=<slug>`) |
| RBAC with `@Roles()` + hierarchy         | `apps/api/src/projects/projects.controller.ts`     | `apps/api/test/rbac.e2e-spec.ts`                                                                  |
| User invitations                         | `dashboard/invitations` → `accept-invitation`      | `apps/api/test/invitations.e2e-spec.ts` · `apps/web/e2e/invitations.spec.ts`                      |
| Account status enforcement               | Admin suspend/unsuspend in platform UI             | `apps/api/test/status-enforcement.e2e-spec.ts` · `apps/web/e2e/platform-users-suspend.spec.ts`    |

### 🔁 Sessions & throttling

| Library feature                | Demonstrated in                                                        | Tested by                                                 |
| ------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| Active sessions list + revoke  | `dashboard/sessions`                                                   | `apps/api/test/sessions-list-revoke.e2e-spec.ts`          |
| FIFO eviction at session limit | Auto-applied by lib config                                             | `apps/api/test/session-fifo-eviction.e2e-spec.ts`         |
| New-session email alert        | Captured in Mailpit on every fresh login                               | `apps/api/test/login-and-logout.e2e-spec.ts` (assertions) |
| Brute-force lockout            | Login surfaces `ACCOUNT_LOCKED`                                        | `apps/api/test/brute-force-lockout.e2e-spec.ts`           |
| Per-route throttling           | `AUTH_THROTTLE_CONFIGS` + `@nestjs/throttler` wired in `app.module.ts` | `apps/api/test/throttle-demo.e2e-spec.ts`                 |

### 🛡️ Platform admin

| Library feature              | Demonstrated in           | Tested by                                      |
| ---------------------------- | ------------------------- | ---------------------------------------------- |
| Separate JWT context + login | `/platform/login`         | `apps/web/e2e/platform-login.spec.ts`          |
| Platform-only routes / shell | `/platform/*` layout      | `apps/web/e2e/platform-shell.spec.ts`          |
| Tenant listing in platform   | `/platform/tenants`       | `apps/web/e2e/platform-tenants.spec.ts`        |
| Platform → tenant isolation  | Library guard rejects mix | `apps/api/test/platform-isolation.e2e-spec.ts` |

### 🔌 Integrations

| Library feature                                      | Demonstrated in                                          | Tested by                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| WebSocket auth (Bearer token + JTI revocation)       | `apps/api/src/notifications/notifications.gateway.ts`    | `apps/api/test/websocket-auth.e2e-spec.ts` · `apps/web/e2e/notifications-isolation.spec.ts` |
| `IAuthHooks` for audit logging                       | `apps/api/src/auth/app-auth.hooks.ts`                    | `apps/api/src/auth/app-auth.hooks.spec.ts`                                                  |
| `IEmailProvider` (Mailpit dev, Resend prod)          | `apps/api/src/auth/mailpit-email.provider.ts` (+ resend) | Smoke-tested in dev via Mailpit                                                             |
| Next.js Edge proxy (`createAuthProxy`)               | `apps/web/proxy.ts`                                      | `apps/web/lib/require-auth.test.ts`                                                         |
| React hooks (`useSession`/`useAuth`/`useAuthStatus`) | `apps/web/components/**`                                 | `apps/web/components/layout/topbar.test.tsx` & friends                                      |

> [!NOTE]
> The full coverage matrix (32 rows, every one ✅) is in [docs/OVERVIEW.md §6](docs/OVERVIEW.md#6-feature-coverage-matrix).

---

## 🏗️ Architecture

Two independently deployable services + three infra services. The web app and API talk JSON over HTTP; session state lives entirely in HttpOnly cookies plus Redis.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser (User Agent)                        │
│                                                                     │
│  HttpOnly cookies: access_token, refresh_token, has_session         │
│  sessionStorage (platform only): platform_access_token              │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ HTTPS (same registrable domain)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Next.js 16 (apps/web) — Turbopack, App Router                      │
│  • Edge proxy `createAuthProxy` → role/cookie gating                │
│  • API route handlers:                                              │
│      /api/auth/silent-refresh  (createSilentRefreshHandler)         │
│      /api/auth/client-refresh  (createClientRefreshHandler)         │
│      /api/auth/logout          (createLogoutHandler)                │
│  • <AuthProvider> + useSession / useAuth / useAuthStatus            │
│  • <NotificationListener> WS consumer                               │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ same-origin rewrite to :4000
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  NestJS 11 (apps/api) — Express 5                                   │
│  • BymaxAuthModule.registerAsync({                                  │
│      jwt, mfa, oauth.google, sessions, bruteForce,                  │
│      passwordReset, platform, invitations, roles,                   │
│      controllers, tokenDelivery: 'cookie', tenantIdResolver })      │
│  • PrismaUserRepository           implements IUserRepository        │
│  • PrismaPlatformUserRepository   implements IPlatformUserRepository│
│  • MailpitEmailProvider           implements IEmailProvider (dev)   │
│  • ResendEmailProvider            implements IEmailProvider (prod)  │
│  • AppAuthHooks                   implements IAuthHooks (audit)     │
│  • NotificationsGateway (WS, guarded by WsJwtGuard)                 │
└──────┬─────────────────────────────────────┬────────────────────────┘
       │                                     │
       ▼                                     ▼
┌─────────────────┐                 ┌────────────────────┐
│  PostgreSQL 18  │                 │     Redis 7        │
│   (port 5432)   │                 │    (port 6379)     │
│                 │                 │                    │
│ users           │                 │ sessions,          │
│ platform_users  │                 │ brute-force        │
│ invitations     │                 │ counters, OTPs,    │
│ projects        │                 │ JWT revocation,    │
│ audit_logs      │                 │ refresh tokens     │
│ tenants         │                 │                    │
└─────────────────┘                 └────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Mailpit (dev) — port 1025 (SMTP) + 8025 (UI)                       │
│  Captures every outbound email; nothing escapes the host machine.   │
└─────────────────────────────────────────────────────────────────────┘
```

### Repository layout

```
nest-auth-example/
├── apps/
│   ├── api/                          # NestJS 11 backend
│   │   ├── prisma/
│   │   │   ├── schema.prisma         # User, PlatformUser, Tenant, Invitation, AuditLog, Project
│   │   │   ├── migrations/
│   │   │   └── seed.ts               # Demo tenants + users + platform admin
│   │   ├── src/
│   │   │   ├── auth/                 # ← LIBRARY WIRING
│   │   │   │   ├── auth.module.ts                # BymaxAuthModule.registerAsync()
│   │   │   │   ├── auth.config.ts                # resolves config from Env
│   │   │   │   ├── prisma-user.repository.ts     # implements IUserRepository
│   │   │   │   ├── prisma-platform-user.repository.ts
│   │   │   │   ├── mailpit-email.provider.ts     # implements IEmailProvider (dev)
│   │   │   │   ├── resend-email.provider.ts      # implements IEmailProvider (prod)
│   │   │   │   ├── app-auth.hooks.ts             # implements IAuthHooks (audit log)
│   │   │   │   ├── app-jwt-auth.guard.ts         # composes JwtAuthGuard + UserStatusGuard
│   │   │   │   └── auth-exception.filter.ts
│   │   │   ├── account/              # /api/account/*  — me, change password, delete
│   │   │   ├── tenants/              # /api/tenants/*  — list, resolve slug→id
│   │   │   ├── projects/             # /api/projects/* — RBAC + tenant scope demo
│   │   │   ├── platform/             # /api/platform/* — admin tenant + user management
│   │   │   ├── invitations/          # /api/invitations/* — create + accept
│   │   │   ├── users/                # /api/users/* — tenant-admin user listing
│   │   │   ├── notifications/        # WS gateway + REST debug endpoints
│   │   │   ├── health/               # /api/health — postgres + redis + lib version
│   │   │   ├── debug/                # /api/debug/* — tenant-isolation demos
│   │   │   ├── prisma/               # PrismaService + module
│   │   │   ├── redis/                # Redis provider + module
│   │   │   ├── logger/               # Pino + nestjs-pino wiring
│   │   │   ├── config/               # Zod env schema + ConfigService<Env, true>
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   └── test/                     # supertest e2e (26 specs, 83 tests)
│   │
│   └── web/                          # Next.js 16 frontend
│       ├── app/
│       │   ├── (auth)/               # public auth pages (shared shell)
│       │   │   ├── login/
│       │   │   ├── register/
│       │   │   ├── forgot-password/
│       │   │   ├── reset-password/   # both ?mode=token and ?mode=otp
│       │   │   ├── verify-email/
│       │   │   ├── mfa-challenge/
│       │   │   └── accept-invitation/
│       │   ├── dashboard/            # protected — uses useSession()
│       │   │   ├── account/
│       │   │   ├── security/         # MFA setup + disable
│       │   │   ├── sessions/         # active devices, revoke
│       │   │   ├── invitations/      # admin invites
│       │   │   ├── projects/         # RBAC demo
│       │   │   └── team/
│       │   ├── platform/             # platform-admin-only area
│       │   │   ├── login/
│       │   │   ├── tenants/
│       │   │   └── users/
│       │   ├── api/auth/
│       │   │   ├── silent-refresh/route.ts   # createSilentRefreshHandler
│       │   │   ├── client-refresh/route.ts   # createClientRefreshHandler
│       │   │   └── logout/route.ts           # createLogoutHandler
│       │   ├── layout.tsx            # <AuthProvider>
│       │   └── providers.tsx
│       ├── proxy.ts                  # createAuthProxy()
│       ├── lib/
│       │   ├── auth-client.ts        # createAuthClient() + tenant slug→CUID resolver
│       │   ├── auth-errors.ts        # translateAuthError(code)
│       │   ├── platform-auth.ts      # platform bearer-token flow
│       │   └── env.ts                # typed env, validated at boot
│       ├── components/
│       │   ├── auth/                 # forms, MFA QR, OtpInput, PasswordInput
│       │   ├── notifications/        # NotificationListener (WS toast)
│       │   ├── layout/               # sidebar, topbar, tenant switcher
│       │   └── ui/                   # shadcn primitives
│       └── e2e/                      # Playwright (21 specs)
│
├── packages/
│   └── _probe/                       # tiny package that imports every lib subpath
│                                     # to fail typecheck if any subpath export breaks
├── docker/
│   ├── postgres/init.sql             # CREATE DATABASE example_app;
│   └── redis/redis.conf              # eviction = volatile-lru
│
├── docs/                             # 11 long-form docs + 16 guidelines
│   ├── OVERVIEW.md                   # product spec + feature coverage matrix
│   ├── GETTING_STARTED.md            # five-minute quickstart
│   ├── FEATURES.md                   # walkthrough of each demonstrated capability
│   ├── ARCHITECTURE.md               # deeper dive
│   ├── ENVIRONMENT.md                # every env var, defaults, validation
│   ├── DATABASE.md                   # schema rationale + migration strategy
│   ├── REDIS.md                      # key namespaces + TTLs
│   ├── EMAIL.md                      # how to swap providers
│   ├── OAUTH_GOOGLE.md               # Google OAuth setup walkthrough
│   ├── DEPLOYMENT.md                 # production checklist
│   ├── TROUBLESHOOTING.md
│   ├── RELEASES.md                   # which lib version each branch tracks
│   └── guidelines/                   # 16 per-stack guideline files (AI-friendly)
│
├── docker-compose.yml                # postgres + redis + mailpit (dev)
├── docker-compose.test.yml           # ephemeral stack for CI / e2e
├── .env.example
├── package.json                      # workspace root
├── pnpm-workspace.yaml
├── AGENTS.md                         # full agent / contributor spec
├── CLAUDE.md                         # quickref for AI agents
└── README.md                         # ← you are here
```

---

## 🧱 Tech Stack

<p>
  <img src="https://img.shields.io/badge/NestJS-11-E0234E?style=flat-square&logo=nestjs&logoColor=white" alt="NestJS 11" />
  <img src="https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js&logoColor=white" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript strict" />
  <img src="https://img.shields.io/badge/Node.js-24%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node 24+" />
  <img src="https://img.shields.io/badge/Prisma-7-2D3748?style=flat-square&logo=prisma&logoColor=white" alt="Prisma 7" />
  <img src="https://img.shields.io/badge/PostgreSQL-18-336791?style=flat-square&logo=postgresql&logoColor=white" alt="Postgres 18" />
  <img src="https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis&logoColor=white" alt="Redis 7" />
  <img src="https://img.shields.io/badge/Tailwind-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind 4" />
  <img src="https://img.shields.io/badge/pnpm-10-F69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm 10" />
  <img src="https://img.shields.io/badge/Docker-Compose%20v2-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker Compose v2" />
  <img src="https://img.shields.io/badge/Jest-30-C21325?style=flat-square&logo=jest&logoColor=white" alt="Jest 30" />
  <img src="https://img.shields.io/badge/Vitest-4-6E9F18?style=flat-square&logo=vitest&logoColor=white" alt="Vitest 4" />
  <img src="https://img.shields.io/badge/Playwright-1-2EAD33?style=flat-square&logo=playwright&logoColor=white" alt="Playwright 1" />
</p>

| Layer             | Choice                        | Why                                                                   |
| ----------------- | ----------------------------- | --------------------------------------------------------------------- |
| Auth              | `@bymax-one/nest-auth@^1.0.2` | The library this repo demonstrates                                    |
| Backend runtime   | Node.js ≥ 24                  | Library minimum; native `node:crypto` for scrypt/AES                  |
| Backend framework | NestJS 11 on Express 5        | Library peer dep                                                      |
| Database          | PostgreSQL 18                 | Most common SaaS choice; first-class tenant-isolation patterns        |
| Cache / sessions  | Redis 7 via `ioredis`         | Library peer dep — session store, JWT blacklist, brute-force counters |
| ORM               | Prisma 7                      | Type-safe, idiomatic in NestJS                                        |
| Email (dev)       | Mailpit                       | Local SMTP capture for testing flows                                  |
| Email (prod)      | Resend (reference)            | Pluggable via `IEmailProvider` — swap with SES, Postmark, etc.        |
| Frontend          | Next.js 16 App Router         | Library peer dep; demonstrates `/nextjs` subpath                      |
| UI framework      | React 19                      | Library peer dep; demonstrates `/react` subpath                       |
| Styling           | Tailwind 4 + shadcn/ui        | De-facto modern default                                               |
| Forms             | react-hook-form 7 + Zod 4     | Boundary validation, the lib's preferred pairing                      |
| Logging           | Pino 10 via `nestjs-pino`     | Structured JSON, request-id correlation, env-driven redact paths      |
| Tests (api)       | Jest 30 + supertest           | NestJS standard                                                       |
| Tests (web unit)  | Vitest 4                      | Fast HMR test runner; ESM-first                                       |
| Tests (web e2e)   | Playwright 1                  | Cross-browser end-to-end                                              |
| Container runtime | Docker Compose v2             | Single-command local stack                                            |
| Package manager   | pnpm 10                       | Matches library; first-class workspace support                        |

---

## 🧪 Testing & Quality

This repo is held to a similar bar as the library itself — every demonstrated flow has a regression-locking test, and CI runs the full matrix on every PR.

| Suite                                           | Test count           | What it covers                                                                                                                  |
| ----------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @nest-auth-example/api test`     | **322** in 28 suites | Unit + integration — repositories, hooks, services, guards composition                                                          |
| `pnpm --filter @nest-auth-example/web test`     | **433** in 47 suites | Vitest — auth client, error mapping, components, layout primitives                                                              |
| `pnpm --filter @nest-auth-example/api test:e2e` | **83** in 26 suites  | supertest e2e — every auth flow against real Postgres + Redis (test stack)                                                      |
| `pnpm --filter @nest-auth-example/web test:e2e` | **23** (no skips)    | Playwright — login, MFA, invitation, password reset, platform admin, workspace switch, OAuth Google click-through, WS isolation |
| **Total**                                       | **861 tests**        | Plus the `_probe` package that fails typecheck if any lib subpath export changes                                                |

### Verification gates (run before every PR)

```bash
pnpm typecheck      # tsc --noEmit across all workspaces  → 0 errors
pnpm lint           # ESLint flat config                   → 0 errors, no suppressions
pnpm format:check   # Prettier                             → clean
pnpm test           # unit + integration                   → 322 + 433 passing
```

### End-to-end gates

```bash
pnpm infra:test:up                                   # ephemeral test stack
pnpm --filter @nest-auth-example/api test:e2e        # 83 supertest e2e
pnpm --filter @nest-auth-example/web test:e2e        # Playwright (auto-starts api + web)
pnpm infra:test:down                                 # tear down
```

> [!NOTE]
> The `--webpack` flag was removed from the `apps/web` scripts in May 2026 once the library shipped to npm. Turbopack (the Next.js 16 default) now resolves the library's subpath exports correctly. See [`apps/web/next.config.mjs`](apps/web/next.config.mjs) for context.

---

## ⚙️ Configuration

Everything is environment-variable driven. The API refuses to start on invalid configuration — Zod validates every value at boot.

### Backend (`apps/api/.env`)

| Variable                                                                              | Required    | Default                         | Purpose                                                  |
| ------------------------------------------------------------------------------------- | ----------- | ------------------------------- | -------------------------------------------------------- |
| `NODE_ENV`                                                                            | yes         | `development`                   | `production` enables cookie `Secure`, hides stack traces |
| `API_PORT`                                                                            | no          | `4000`                          | Nest HTTP port                                           |
| `WEB_ORIGIN`                                                                          | yes         | `http://localhost:3000`         | CORS allowlist                                           |
| `DATABASE_URL`                                                                        | yes         | —                               | Prisma connection string                                 |
| `REDIS_URL`                                                                           | yes         | —                               | `ioredis` connection string                              |
| `JWT_SECRET`                                                                          | yes         | —                               | `openssl rand -hex 64` — ≥ 64 chars                      |
| `MFA_ENCRYPTION_KEY`                                                                  | yes         | —                               | `openssl rand -base64 32` — 32-byte base64               |
| `EMAIL_PROVIDER`                                                                      | no          | `mailpit`                       | `mailpit` or `resend`                                    |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_FROM`                                               | conditional | `localhost:1025` / `no-reply@…` | Required when `EMAIL_PROVIDER=mailpit`                   |
| `RESEND_API_KEY`                                                                      | conditional | —                               | Required when `EMAIL_PROVIDER=resend`                    |
| `OAUTH_GOOGLE_CLIENT_ID` / `OAUTH_GOOGLE_CLIENT_SECRET` / `OAUTH_GOOGLE_CALLBACK_URL` | optional    | —                               | Both ID and SECRET required to enable Google OAuth       |
| `PASSWORD_RESET_METHOD`                                                               | no          | `token`                         | `token` or `otp`                                         |
| `LOG_LEVEL`                                                                           | no          | `info`                          | `debug`, `info`, `warn`, `error`                         |

### Frontend (`apps/web/.env.local`)

| Variable                           | Required | Purpose                                                                                |
| ---------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `INTERNAL_API_URL`                 | yes      | URL the Next.js server proxies to (no `/api` prefix) — usually `http://localhost:4000` |
| `AUTH_JWT_SECRET_FOR_PROXY`        | yes      | Same value as API's `JWT_SECRET` — the proxy decodes cookies locally                   |
| `NEXT_PUBLIC_API_URL`              | yes      | Browser-visible API base — usually `http://localhost:3000/api`                         |
| `NEXT_PUBLIC_WS_URL`               | yes      | WebSocket base — usually `ws://localhost:3000`                                         |
| `NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED` | no       | `true` to show the "Continue with Google" button                                       |

➡ **Full reference:** [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)

---

## 📦 Library consumption

This repo consumes `@bymax-one/nest-auth` from npm — no sibling checkout, no global links, no workspace tricks. The wiring lives in a single module:

```typescript
// apps/api/src/auth/auth.module.ts (excerpt)
BymaxAuthModule.registerAsync({
  imports: [ConfigModule, PrismaModule, RedisModule, LoggerModule],
  inject: [ConfigService, PrismaService, REDIS_CLIENT, Logger],
  useFactory: (config, prisma, redis, logger) => buildAuthOptions(config, prisma, redis, logger),
});
```

```typescript
// apps/web/proxy.ts (excerpt)
import { createAuthProxy } from '@bymax-one/nest-auth/nextjs';

export default createAuthProxy({
  apiBase: env.INTERNAL_API_URL,
  jwtSecret: env.AUTH_JWT_SECRET_FOR_PROXY,
  // … cookie names, login paths, public routes …
});
```

```typescript
// apps/web/app/layout.tsx (excerpt)
import { AuthProvider } from '@bymax-one/nest-auth/react';

return (
  <html>
    <body>
      <AuthProvider apiBase="/api">{children}</AuthProvider>
    </body>
  </html>
);
```

➡ See the full module wiring in [apps/api/src/auth/](apps/api/src/auth/) and the React side in [apps/web/app/providers.tsx](apps/web/app/providers.tsx).

> [!IMPORTANT]
> **Library fidelity is a release gate.** This repo never reshapes the library's DTOs, never re-implements its guards, and never maintains a parallel error-code map. If the library changes a signature, this repo is updated to match — not patched to keep the old shape. See [docs/guidelines/nest-auth-guidelines.md](docs/guidelines/nest-auth-guidelines.md).

---

## 🛡️ Security defaults

Every default here is on the side of safety. Tweak them only when you have a stronger constraint than the library's threat model.

| Default                                  | Where                                                       | Why                                                     |
| ---------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| HttpOnly + SameSite cookies              | Library cookie config in `apps/api/src/auth/auth.config.ts` | XSS-resistant token storage                             |
| CORS allowlisted to `WEB_ORIGIN`         | `apps/api/src/main.ts`                                      | No wildcard origins, ever                               |
| Helmet headers + `csp: false`            | `apps/api/src/main.ts`                                      | App Router handles CSP; Helmet covers everything else   |
| Pino `redact` on tokens, headers, body   | `apps/api/src/logger/logger.module.ts`                      | Never log secrets, OTPs, refresh tokens, `passwordHash` |
| Tenant isolation read-only on header     | Library `tenantIdResolver`                                  | User input can't dictate `tenantId`                     |
| Validation on every request body         | class-validator DTOs + Zod for boundaries                   | No raw `any` reaches a service                          |
| `exactOptionalPropertyTypes` + strict TS | `tsconfig.base.json`                                        | `undefined` vs missing is explicit                      |
| Env validated at boot                    | `apps/api/src/config/env.schema.ts`                         | Wrong env stops the app, not a 500 at runtime           |

➡ Full policy: [docs/guidelines/security-privacy-guidelines.md](docs/guidelines/security-privacy-guidelines.md)

---

## 🐳 Docker

The dev stack runs three services, all bound to `127.0.0.1`:

| Service    | Image                | Host port(s)   | Volume   | Purpose                                             |
| ---------- | -------------------- | -------------- | -------- | --------------------------------------------------- |
| `postgres` | `postgres:18-alpine` | `5432`         | `pgdata` | Primary DB                                          |
| `redis`    | `redis:7-alpine`     | `6379`         | `rdata`  | Sessions, brute-force counters, JWT blacklist, OTPs |
| `mailpit`  | `axllent/mailpit@…`  | `1025`, `8025` | —        | Dev SMTP capture + UI at http://localhost:8025      |

The test stack (`docker-compose.test.yml`) mirrors the same images but uses alternate ports (`55432`, `56379`, `58025`) and `tmpfs` volumes for ephemeral CI runs — runs alongside the dev stack without collision.

```bash
pnpm infra:up         # start dev stack
pnpm infra:down       # stop (keep data)
pnpm infra:nuke       # stop AND wipe volumes
pnpm infra:test:up    # ephemeral test stack
pnpm infra:logs       # tail all containers
```

---

## 🚢 Deployment

The example targets a two-service topology. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full checklist.

- `apps/api` → any Node-24 host (Fly.io, Railway, ECS, Kubernetes) with Postgres + Redis reachable
- `apps/web` → Vercel, Netlify, or self-hosted Node — set `INTERNAL_API_URL` to the API service URL
- **Same registrable domain** for both services so cookies travel — use a subdomain like `app.example.com` for `web` and `api.example.com` for `api`, then configure `cookies.resolveDomains` accordingly
- **Cookie flags in prod:** `Secure: true`, `SameSite=Lax` for OAuth callback compat
- **JWT rotation:** the library supports `jwt.previousSecrets` for zero-downtime rotation
- **Email:** flip to `EMAIL_PROVIDER=resend` and configure SPF/DKIM/DMARC on your sender domain
- **Audit logs:** ship the `audit_logs` table to your SIEM via Postgres logical replication or a CDC tool

---

## 🗺️ Where to go next

- [📖 Overview & Feature Matrix](docs/OVERVIEW.md) — the full product spec
- [🚀 Getting Started](docs/GETTING_STARTED.md) — five-minute quickstart with screenshots
- [🧪 Features walkthrough](docs/FEATURES.md) — every demonstrated capability, end-to-end
- [🏛️ Architecture](docs/ARCHITECTURE.md) — module boundaries, request lifecycle, edge cases
- [🔧 Environment](docs/ENVIRONMENT.md) — every env var, defaults, validation rules
- [🐘 Database](docs/DATABASE.md) — Prisma schema rationale and migration strategy
- [🔴 Redis](docs/REDIS.md) — key namespaces, TTLs, and eviction policies
- [📬 Email](docs/EMAIL.md) — how to swap providers without touching auth logic
- [🔐 Google OAuth](docs/OAUTH_GOOGLE.md) — turn the "Continue with Google" button into a working sign-in in ~10 min
- [🚢 Deployment](docs/DEPLOYMENT.md) — production checklist
- [🛠️ Troubleshooting](docs/TROUBLESHOOTING.md) — common snags and how to fix them
- [🤖 AGENTS.md](AGENTS.md) — full spec for AI coding agents
- [📚 Library guidelines](docs/guidelines/) — 16 per-stack guidelines for contributors

---

## 🤝 Contributing

Issues and PRs are welcome. Because this is a reference application, the bar for changes is:

> _"Does this make the demonstration of `@bymax-one/nest-auth` clearer or more complete?"_

Generic refactors that obscure library usage will be declined. See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) for the full process.

```bash
# Clone
git clone https://github.com/bymaxone/nest-auth-example.git
cd nest-auth-example

# Install
pnpm install

# Verify
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test

# Run
pnpm infra:up && pnpm dev
```

---

## 🔒 Security policy

If you find a security vulnerability — in **either this example or the library** — please **do not** open a public issue. Email **support@bymax.one** with details.

We respond promptly. See [SECURITY.md](../nest-auth/SECURITY.md) in the library for the disclosure timeline.

---

## 📄 License

[MIT](LICENSE) © [Bymax One](https://bymax.one)

Library source: [`@bymax-one/nest-auth`](https://github.com/bymaxone/nest-auth) — MIT.

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/bymaxone">Bymax One</a> to demonstrate <a href="https://www.npmjs.com/package/@bymax-one/nest-auth">@bymax-one/nest-auth</a>.</sub>
</p>
