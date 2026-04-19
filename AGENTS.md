# AGENTS.md — nest-auth-example

Complete spec for AI coding agents working on `nest-auth-example`. Read before starting any non-trivial task. For a faster skim, start with [CLAUDE.md](CLAUDE.md).

---

## How to read this document

1. **[CLAUDE.md](CLAUDE.md)** — quickest rule summary. Open every session.
2. **This doc** — Critical Rules, Architecture, Common Pitfalls. Open for any task that isn't a one-line fix.
3. **[docs/guidelines/](docs/guidelines/)** — one guideline per stack area. Open **only** the ones your task touches.
4. **[docs/OVERVIEW.md](docs/OVERVIEW.md)** and **[docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)** — product context, feature coverage matrix, phase-by-phase roadmap.

Never open every guideline. Always load on demand using the table in [Reference documentation](#reference-documentation).

---

## Table of contents

- [Critical rules](#critical-rules)
- [Project overview](#project-overview)
- [Stack](#stack)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Code standards](#code-standards)
- [Feature workflow](#feature-workflow)
- [Testing](#testing)
- [Configuration & env](#configuration--env)
- [Observability](#observability)
- [Security & privacy](#security--privacy)
- [Library consumption](#library-consumption)
- [Common pitfalls](#common-pitfalls)
- [Pre-commit checklist](#pre-commit-checklist)
- [Reference documentation](#reference-documentation)

---

## Critical rules

Non-negotiable. Violation blocks merge.

### 1. Library-faithful

`@bymax-one/nest-auth` exports are used **as shipped**. No reshaping library DTOs, no re-implementing guards (`JwtAuthGuard`, `RolesGuard`, `UserStatusGuard`, `MfaRequiredGuard`, `JwtPlatformGuard`, `WsJwtGuard`), no parallel error-code map — use `AUTH_ERROR_CODES`.

See [docs/guidelines/nest-auth-guidelines.md](docs/guidelines/nest-auth-guidelines.md).

### 2. Multi-tenant isolation

Every user-facing row has `tenantId`. Every query scopes by it. `tenantIdResolver` reads **only** from the `X-Tenant-Id` header. User input never dictates `tenantId`.

### 3. TypeScript strict

- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `verbatimModuleSyntax: true`.
- **Never** `any`, `// @ts-ignore`, `// @ts-expect-error`, `as any`.
- **Never** `// eslint-disable` (inline or file-level).

See [docs/guidelines/typescript-guidelines.md](docs/guidelines/typescript-guidelines.md) and [docs/guidelines/lint-format-guidelines.md](docs/guidelines/lint-format-guidelines.md).

### 4. Comments in English + documentation mandatory

- Every code comment, JSDoc, and inline note in English.
- **File-header JSDoc** on every non-trivial file: purpose, layer, constraints.
- **JSDoc block on every exported** function, hook, component, service, DTO — with `@param`, `@returns`, `@throws` where relevant.
- **Inline comments** explain the _why_ where the code is non-obvious.
- **Every test `it`** carries a short comment describing the scenario and the rule it protects.
- **Stale comments are bugs**. Update comments in the same commit as the code.

Full policy: [docs/guidelines/coding-style.md § Code documentation](docs/guidelines/coding-style.md#code-documentation--mandatory).

### 5. No cross-feature imports

`projects/` does not import from `tenants/`. Share via shared modules (`prisma/`, `redis/`, `config/`) or orchestrate in a service one level up. No backdoors.

### 6. Security defaults

- Cookies HttpOnly, `secure` derived from `NODE_ENV`, `SameSite=Lax`.
- CORS single-origin via `WEB_ORIGIN`, `credentials: true`.
- Global validation pipe: `whitelist + forbidNonWhitelisted + transform`.
- Env vars validated at boot; `EMAIL_PROVIDER=mailpit` rejected in production.

See [docs/guidelines/security-privacy-guidelines.md](docs/guidelines/security-privacy-guidelines.md) and [docs/guidelines/environment-guidelines.md](docs/guidelines/environment-guidelines.md).

### 7. No direct `process.env.*` or `console.*`

- Env via `ConfigService<Env, true>` (api) or `lib/env.ts` (web).
- Logs via the injected Pino logger. No `console.log` / `console.error` anywhere in runtime code.

### 8. No banned patterns

- `any`, `as any`, `// @ts-ignore`, `// eslint-disable`, `console.log`, `throw 'string'`, `@Body() body: any`.
- Raw SQL concatenation (`$queryRaw` uses tagged templates).
- Hex colors outside `@theme` in `apps/web/app/globals.css`.
- `npm` / `yarn` (pnpm workspace).
- `git commit` / `git push` by agents (see Rule 10).

### 9. Library-owned Redis namespace

Library owns `nest-auth-example:*`. App-owned keys live under `nest-auth-example:app:*`. Any key outside the prefixes is a bug. See [docs/guidelines/redis-guidelines.md](docs/guidelines/redis-guidelines.md).

### 10. Git — no commit/push by agents

Never run `git commit` or `git push`. Prepare them as suggestions. The user reviews files and runs them. No `--no-verify`, no `--no-gpg-sign` unless the user explicitly asks. See [docs/guidelines/git-workflow.md](docs/guidelines/git-workflow.md).

---

## Project overview

**`nest-auth-example`** is the canonical reference application for `@bymax-one/nest-auth` — a full-stack authentication library for NestJS + Next.js. The repo is simultaneously:

- A **runnable demo**: `git clone`, `docker compose up`, you get a working multi-tenant SaaS auth server with a Next.js dashboard.
- A **knowledge base**: every feature of the library is exercised and documented.
- A **living test harness**: used by library maintainers to validate public APIs.

Scope boundaries:

- **Not a starter template.** A separate `create-bymax-app` repo handles that.
- **Not a UI kit.** shadcn/ui + Tailwind are chosen for familiarity, not as requirements.
- **Not a CMS / billing / admin platform.**

Full context: [docs/OVERVIEW.md](docs/OVERVIEW.md). Coverage matrix: [docs/OVERVIEW.md §6](docs/OVERVIEW.md). Roadmap: [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md).

---

## Stack

Versions pinned in `package.json` at root and in each app. Full inventory below; version rationale in the linked guidelines.

| Area               | Tech                                                                         |
| ------------------ | ---------------------------------------------------------------------------- |
| Monorepo           | pnpm `^10.8`, Node `>=24`                                                    |
| Language           | TypeScript **6.0** strict                                                    |
| Backend framework  | NestJS **11.1** on Express **5**                                             |
| ORM                | Prisma **7.7** + PostgreSQL **18**                                           |
| Cache / sessions   | `ioredis` **5.10** + Redis **7**                                             |
| Logging            | `nestjs-pino` **4.6** + Pino **10.3** + `pino-http` **11**                   |
| Validation         | `class-validator` **0.15** + `class-transformer` **0.5**, Zod **4.3**        |
| Email              | `nodemailer` **8.0** (Mailpit dev), Resend SDK (prod)                        |
| Backend testing    | Jest **30**, supertest **7.2**                                               |
| Frontend framework | Next.js **16.2** (App Router)                                                |
| React              | **19.2**                                                                     |
| Styling            | Tailwind **4.2** + `@tailwindcss/postcss`, shadcn/ui, Radix UI, lucide-react |
| Forms              | React Hook Form **7.72** + `@hookform/resolvers` **5.2**                     |
| Toasts             | sonner **2.0**                                                               |
| Frontend testing   | Vitest **4.1**, `@testing-library/react` **16.3**, Playwright **1.59**       |
| Auth library       | `@bymax-one/nest-auth` `^1.0.0` (linked from sibling checkout during dev)    |
| Lint / format      | ESLint **10** flat + `typescript-eslint` **8.58**, Prettier **3.8**          |
| Hooks              | Husky **9.1** + lint-staged **16.4**                                         |
| Infra              | Docker Compose v2 (Postgres, Redis, Mailpit)                                 |

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Browser — HttpOnly cookies: access_token, refresh_token   │
└──────────────────────────┬─────────────────────────────────┘
                           │ HTTPS
                           ▼
┌────────────────────────────────────────────────────────────┐
│  apps/web — Next.js 16 App Router                          │
│  • createAuthProxy       (proxy.ts middleware)             │
│  • createAuthClient      (lib/auth-client.ts)              │
│  • <AuthProvider>        (app/layout.tsx)                  │
│  • route.ts handlers     (silent-refresh, client-refresh,  │
│                           logout — all from the library)   │
└──────────────────────────┬─────────────────────────────────┘
                           │ JSON over same-origin
                           ▼
┌────────────────────────────────────────────────────────────┐
│  apps/api — NestJS 11 (Express 5)                          │
│  • BymaxAuthModule.registerAsync                           │
│      ├─ JWT (cookie mode, rotation, revocation)            │
│      ├─ MFA (TOTP + recovery)                              │
│      ├─ OAuth (Google plugin)                              │
│      ├─ Sessions (Redis, FIFO)                             │
│      ├─ Password reset (token + OTP modes)                 │
│      ├─ Invitations, Platform admin, WebSocket auth        │
│      └─ Brute-force + @nestjs/throttler                    │
│  • PrismaUserRepository        IUserRepository             │
│  • PrismaPlatformUserRepo      IPlatformUserRepository     │
│  • MailpitEmailProvider        IEmailProvider              │
│  • AppAuthHooks                IAuthHooks (audit log)      │
└─────┬───────────────────────────────┬──────────────────────┘
      │                               │
      ▼                               ▼
┌─────────────┐                ┌──────────────┐
│ PostgreSQL  │                │    Redis     │
│  • users    │                │  sessions,   │
│  • invites  │                │  otps,       │
│  • audit    │                │  brute force │
└─────────────┘                └──────────────┘

┌────────────────────────────────────────────────────────────┐
│  Mailpit (dev only, port 8025) — captures all outbound     │
└────────────────────────────────────────────────────────────┘
```

Layers are strict top-down. Controllers → services → repositories. Services never call Prisma directly; repositories never call services. Frontend UI → components → hooks → `authClient`.

---

## Project structure

```
nest-auth-example/
├── apps/
│   ├── api/                          NestJS backend
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   ├── src/
│   │   │   ├── auth/                 library wiring
│   │   │   │   ├── auth.config.ts
│   │   │   │   ├── auth.module.ts
│   │   │   │   ├── prisma-user.repository.ts
│   │   │   │   ├── prisma-platform-user.repository.ts
│   │   │   │   ├── email/
│   │   │   │   │   ├── mailpit-email.provider.ts
│   │   │   │   │   └── resend-email.provider.ts
│   │   │   │   └── app-auth.hooks.ts
│   │   │   ├── config/               env schema + ConfigModule
│   │   │   ├── prisma/               PrismaService + module
│   │   │   ├── redis/                RedisService + module
│   │   │   ├── health/
│   │   │   ├── tenants/
│   │   │   ├── projects/
│   │   │   ├── platform/
│   │   │   ├── notifications/        WebSocket gateway
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   └── test/                     supertest e2e
│   │
│   └── web/                          Next.js 16 frontend
│       ├── app/
│       │   ├── (auth)/
│       │   │   ├── login/
│       │   │   ├── register/
│       │   │   ├── forgot-password/
│       │   │   ├── reset-password/
│       │   │   ├── verify-email/
│       │   │   ├── mfa-challenge/
│       │   │   └── accept-invitation/
│       │   ├── dashboard/
│       │   │   ├── account/
│       │   │   ├── security/
│       │   │   ├── sessions/
│       │   │   ├── invitations/
│       │   │   └── team/
│       │   ├── platform/
│       │   ├── api/auth/             route handlers from the library
│       │   ├── layout.tsx
│       │   └── page.tsx
│       ├── proxy.ts                  createAuthProxy
│       ├── lib/
│       │   ├── auth-client.ts
│       │   └── env.ts
│       ├── components/
│       │   ├── auth/
│       │   └── ui/                   shadcn primitives
│       └── tests/e2e/                Playwright
│
├── docker/
│   ├── postgres/init.sql
│   └── redis/redis.conf
│
├── docs/
│   ├── OVERVIEW.md
│   ├── DEVELOPMENT_PLAN.md
│   ├── guidelines/                   ← domain guidelines (load on demand)
│   ├── tasks/                        phase-by-phase task files
│   └── decisions/                    ADRs (created when first ADR lands)
│
├── docker-compose.yml
├── docker-compose.override.yml
├── docker-compose.test.yml
├── eslint.config.mjs
├── .prettierrc.mjs
├── commitlint.config.mjs
├── lint-staged.config.mjs
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── CLAUDE.md
└── AGENTS.md                         ← you are here
```

**Rules**:

- `apps/api/src/<feature>/` self-contained: `dto/`, `<feature>.controller.ts`, `<feature>.service.ts`, `<feature>.module.ts`, `<feature>.spec.ts`.
- `apps/web/components/ui/` owns shadcn primitives (copied in). Feature components live in `components/<feature>/`.
- Path aliases: `@/*` → `src/*` in each app.
- No `../../` beyond one level.

---

## Code standards

### Naming

| Kind                 | Convention                 | Example                                 |
| -------------------- | -------------------------- | --------------------------------------- |
| TS file              | kebab-case                 | `prisma-user.repository.ts`             |
| React component file | kebab-case                 | `login-form.tsx`                        |
| React component      | PascalCase                 | `LoginForm`                             |
| Hook                 | camelCase, `use*`          | `useAuthFormState`                      |
| NestJS class         | PascalCase + suffix        | `ProjectsService`, `ProjectsController` |
| NestJS module        | PascalCase + `Module`      | `ProjectsModule`                        |
| Provider token       | UPPER_SNAKE `Symbol('…')`  | `EMAIL_PROVIDER`                        |
| Union literal        | snake_case                 | `'password_reset_sent'`                 |
| Folder               | kebab-case                 | `password-reset/`                       |
| DB column            | snake_case                 | `created_at`, `tenant_id`               |
| DB table             | plural snake_case          | `users`, `audit_logs`                   |
| Env var              | UPPER_SNAKE                | `JWT_SECRET`                            |
| Boolean              | `is/has/should/can` prefix | `isLoading`, `hasPermission`            |

Formatting: single quotes, semicolons, 2-space, 100-col, trailing comma `all`. Managed by Prettier — do not hand-format.

### Imports (ordered, blank-separated groups)

1. Node built-ins / external packages
2. Internal absolute (`@/...`)
3. Type-only (`import type { … }`)
4. Parent (one level max)
5. Sibling

ESM requires explicit `.js` extension on relative imports (e.g., `import { foo } from './foo.js'`).

### Types over enums

Union literals + `as const` objects. No TS `enum` unless re-exporting from a library.

### Zod / class-validator at boundaries

Every external input validated. Backend controllers use `class-validator` DTOs; env and frontend use Zod. Never both in the same layer. See [docs/guidelines/validation-guidelines.md](docs/guidelines/validation-guidelines.md).

### Error handling

- Throw specific Nest exceptions in the API; map to `AUTH_ERROR_CODES` for auth failures.
- `try/catch (err)` — `err` is `unknown`, narrow before use.
- Never swallow: re-throw or explicitly log + degrade.
- Library-thrown exceptions are **not** wrapped — let them bubble.

### Documentation — required

See the full policy in [docs/guidelines/coding-style.md § Code documentation](docs/guidelines/coding-style.md#code-documentation--mandatory). Summary:

- File headers on every non-trivial file.
- JSDoc on every exported symbol, with `@param`, `@returns`, `@throws`.
- Inline "why" comments for non-obvious behavior.
- Scenario comments on every test `it`.
- English only, kept fresh.

---

## Feature workflow

When adding or modifying a feature:

1. **Read the coverage matrix** — [docs/OVERVIEW.md §6](docs/OVERVIEW.md). If the feature isn't listed, question whether it belongs here.
2. **Check the phase plan** — [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) and `docs/tasks/phase-*.md`.
3. **Open only the relevant guidelines** — see the task → guideline table in [CLAUDE.md](CLAUDE.md).
4. **Backend**:
   - Update `prisma/schema.prisma` if a schema change is required; generate a migration.
   - Write the service + repository (if the feature owns data).
   - Expose via controller with DTO validation.
   - Wire guards / decorators from the library; do not re-implement.
   - Add `IAuthHooks` audit rows for new lifecycle events.
5. **Frontend**:
   - Server component at the route; client component at the interactive leaf.
   - Form via React Hook Form + Zod.
   - `authClient` for server calls; never reach `apps/api` directly without the client.
   - Use shadcn primitives and `cn()` for styling.
6. **Tests**:
   - Unit / integration per repository change.
   - supertest e2e per new HTTP path.
   - Playwright per new user journey.
7. **Docs**:
   - Update the Feature Coverage Matrix if a row gets a new "Demonstrated in" value.
   - New patterns → new guideline or amend the existing one.

For complex changes, produce a short plan doc in `docs/tasks/` before touching code.

---

## Testing

Pyramid (intent, not quota):

```
  Playwright (apps/web)    ~5% — critical journeys
  supertest (apps/api)     ~20% — auth flows end-to-end
  Integration              ~40% — repository / service with real deps
  Unit                     ~35% — pure functions, components
```

**MVP coverage priority**: every public HTTP surface for auth (`/auth/register`, `/auth/login`, MFA paths, password reset variants, sessions, invitations, platform, OAuth) has at least one supertest e2e. Every user journey in [docs/OVERVIEW.md §12](docs/OVERVIEW.md) has a Playwright spec.

Commands:

```bash
pnpm test                                            # all packages
pnpm --filter @nest-auth-example/api test:e2e        # supertest
pnpm --filter @nest-auth-example/web test:e2e        # Playwright
pnpm infra:test:up                                   # ephemeral stack
```

Comment policy, fixtures, flake rules: [docs/guidelines/testing-guidelines.md](docs/guidelines/testing-guidelines.md).

---

## Configuration & env

- Schema: `apps/api/src/config/env.schema.ts` (Zod), `apps/web/lib/env.ts` (Zod).
- Validated at boot; app refuses to start on missing or malformed values.
- `.env.example` at the repo root carries shape with placeholders; never real values.
- `NEXT_PUBLIC_*` is the only prefix allowed in client bundles.
- Production refuses dev defaults (`EMAIL_PROVIDER=mailpit` rejected in prod).

See [docs/guidelines/environment-guidelines.md](docs/guidelines/environment-guidelines.md).

---

## Observability

- **Logs**: Pino structured, `event.name` style messages, `requestId` + `tenantId` on every line, redaction paths for secrets.
- **Audit**: `audit_logs` table written via `AppAuthHooks` (`IAuthHooks`). Append-only, never updated or deleted.
- **Health**: `/health` on the API (DB + Redis + library), `/api/health` on web (liveness).
- **Metrics / tracing**: not wired today; hooks reserved for OpenTelemetry.

See [docs/guidelines/observability-guidelines.md](docs/guidelines/observability-guidelines.md) and [docs/guidelines/logging-guidelines.md](docs/guidelines/logging-guidelines.md).

---

## Security & privacy

One dedicated guideline. Read before any code that touches auth, user data, cookies, CORS, or secrets: [docs/guidelines/security-privacy-guidelines.md](docs/guidelines/security-privacy-guidelines.md).

Highlights:

- HttpOnly cookies, `secure` derived from `NODE_ENV`.
- CORS single-origin via `WEB_ORIGIN`, `credentials: true`.
- DTO / Zod validation at every boundary.
- Library RBAC (`@Roles`, `RolesGuard`); no hand-rolled `role === 'admin'` checks.
- Multi-tenant scoping on every query.
- Secrets only in `.env` (gitignored), validated at boot.
- Append-only audit; no logs of `passwordHash`, tokens, OTPs.

---

## Library consumption

`@bymax-one/nest-auth` is the product this repo demonstrates. Every wiring choice follows [docs/guidelines/nest-auth-guidelines.md](docs/guidelines/nest-auth-guidelines.md):

- `BymaxAuthModule.registerAsync({ ... })` — async only, config validated first.
- Four app-owned contracts to implement: `IUserRepository`, `IPlatformUserRepository`, `IEmailProvider`, `IAuthHooks`. Everything else comes from the library.
- Global guard order: `JwtAuthGuard` → `UserStatusGuard` → `MfaRequiredGuard` → `RolesGuard`.
- Frontend: `createAuthClient`, `createAuthProxy`, three library-owned `route.ts` handlers, `<AuthProvider>`, `useSession`/`useAuth`/`useAuthStatus`.

---

## Common pitfalls

Pulled from real anti-patterns in equivalent projects. Skim before finishing any task.

### 🔐 Auth & privacy

1. **Reshaping library objects** (selecting a few fields from `User` to be polite) — breaks JWT signing, MFA decrypt, session resume.
2. **Re-hashing `passwordHash`** — locks every user out.
3. **Logging request bodies** — often contain credentials. Log fields, not bodies.
4. **Wrong guard order** — `MfaRequiredGuard` before `JwtAuthGuard` yields confusing 401/403 mixes.
5. **User-controlled `tenantId`** — always via `X-Tenant-Id` header + resolver.
6. **Missing `has_session` cookie** — edge proxy and `useAuthStatus()` misbehave.
7. **Custom role check inside a controller** — bypasses audit and ordering. Use `@Roles`.

### 🏗️ Architecture

8. **Cross-feature imports** — use shared modules or orchestrate one level up.
9. **Service importing a controller** — top never imports bottom. Restructure.
10. **Repository calling another service** — repositories are thin translation.
11. **New top-level dep without documenting** in the relevant guideline — catalog drift.
12. **Duplicate middleware** — Next runs only one; the library's `proxy.ts` is the single source.

### 🗄️ Data

13. **Missing `@@unique([tenantId, email])`** — cross-tenant collisions.
14. **Missing `@@index([tenantId])`** — dashboards degrade as tables grow.
15. **`select: { passwordHash: true }`** outside the library's own flow — leaks hash to logs/serializers.
16. **Non-idempotent seed** — `pnpm infra:up && pnpm seed` breaks after the first run. `upsert` by unique key.
17. **Raw SQL via string concatenation** — always `$queryRaw` tagged templates.

### ♻️ Redis

18. **Missing TTL** — `volatile-lru` can't evict; OOM builds over time.
19. **`KEYS` in hot paths** — blocks the event loop. Use `SCAN`.
20. **Shared ioredis connection for pub/sub + commands** — ioredis throws.

### 🖥️ Frontend

21. **`'use client'` on a layout** — loses streaming + server data.
22. **`cookies()` / `headers()` without `await`** — TS error in 16.
23. **`process.env.*` in a client component** — `undefined` at runtime for anything but `NEXT_PUBLIC_*`.
24. **Client fetch to `apps/api` without `credentials: 'include'`** — cookies never attach.
25. **Hex colors outside `@theme`** — breaks dark mode and token drift.
26. **Template-literal class names** (`bg-${color}`) — JIT skips; class not generated.
27. **`TouchableOpacity` / `onClick` on a `<div>`** — a11y failure; use `<button>`.

### 📝 Forms

28. **Schema recreated every render** — RHF resets. Declare outside or memoize.
29. **`register` with a custom component** — no `onChange`. Use `Controller`.
30. **`mode: 'onChange'`** on create flows — noisy; use `onTouched`.
31. **Rendering raw server error message** — leaks internals. Map through `AUTH_ERROR_CODES`.

### 🧪 Testing

32. **Mocking `@bymax-one/nest-auth`** — defeats the entire purpose.
33. **Mocking Prisma in e2e** — tests should run against the real DB via `docker-compose.test.yml`.
34. **Asserting on exact error messages** — wording changes. Assert on status + code.
35. **`data-testid` over role/label** — couples to implementation.
36. **Timezone-sensitive assertions** — pin the clock or compare ISO.
37. **`it` without a scenario comment** — name alone rarely explains the rule.

### 📝 Documentation

38. **Missing file-header JSDoc** on a new file.
39. **Missing JSDoc on a new exported symbol**.
40. **Stale comments** not updated alongside the code.
41. **Comments in Portuguese / Spanish** — English only.

### 🛠️ Tooling

42. **`npm` / `yarn` on a pnpm workspace** — corrupts the store.
43. **`pnpm install` without a filter** for a single-workspace dep — bloats the root.
44. **Hook bypass** (`--no-verify`) — hides a real issue.
45. **Force-push on a shared branch** — destroys review state.

### 🔧 Git (agent-specific)

46. **Agent running `git commit`** — user always commits manually.
47. **Agent running `git push`** — same.
48. **Amending a pushed commit** — breaks teammates' local state.

---

## Pre-commit checklist

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

Manual sweep on diff:

- [ ] No `console.log` / `console.warn` / `console.error`.
- [ ] No `any`, no `@ts-ignore`, no `@ts-expect-error`, no `eslint-disable`.
- [ ] All comments in English.
- [ ] File-header JSDoc on every new non-trivial file.
- [ ] JSDoc on every new exported function / hook / component / service / DTO.
- [ ] Every new test `it` has a scenario comment.
- [ ] No stale comments — updated in the same commit as the behavior.
- [ ] No hardcoded secrets, tokens, or URLs outside `.env` / tokens.
- [ ] No hex literals outside `@theme` in `globals.css`.
- [ ] No `../../` beyond one level.
- [ ] No cross-feature imports.
- [ ] No reshaping of `@bymax-one/nest-auth` objects; `AUTH_ERROR_CODES` used for auth errors.
- [ ] `tenantId` scoping preserved on every new query.
- [ ] New DB schema → migration generated + reviewed.
- [ ] New env var → added to Zod schema + `.env.example` group + refinement where applicable.
- [ ] New external dep documented in the relevant guideline.
- [ ] Accessibility: semantic HTML, `aria-*` on interactive elements, focus ring.

Full review checklist: [docs/guidelines/pr-review.md](docs/guidelines/pr-review.md).

---

## Reference documentation

**Open guidelines on demand.** The agent should open only the files needed for the current task.

### Stack guidelines (`docs/guidelines/`)

| Domain                                                               | When to read                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [nestjs-guidelines.md](docs/guidelines/nestjs-guidelines.md)         | Modules, controllers, services, guards, DTOs, `main.ts`, bootstrap             |
| [prisma-guidelines.md](docs/guidelines/prisma-guidelines.md)         | Schema, queries, migrations, seeding, repository patterns                      |
| [postgres-guidelines.md](docs/guidelines/postgres-guidelines.md)     | Indexes, raw SQL, locking, migrations in prod                                  |
| [redis-guidelines.md](docs/guidelines/redis-guidelines.md)           | Connection, key design, TTL, pub/sub, testing                                  |
| [nextjs-guidelines.md](docs/guidelines/nextjs-guidelines.md)         | App Router, route handlers, middleware, server/client boundary                 |
| [react-guidelines.md](docs/guidelines/react-guidelines.md)           | Components, hooks, context, React 19 additions                                 |
| [tailwind-guidelines.md](docs/guidelines/tailwind-guidelines.md)     | Tailwind 4 CSS-first config, shadcn/ui primitives, accessibility               |
| [typescript-guidelines.md](docs/guidelines/typescript-guidelines.md) | Strictness, `unknown`, generics, ESM imports, module augmentation              |
| [forms-guidelines.md](docs/guidelines/forms-guidelines.md)           | React Hook Form + Zod + `@hookform/resolvers`, server errors, accessibility    |
| [validation-guidelines.md](docs/guidelines/validation-guidelines.md) | class-validator DTOs + Zod schemas; division of responsibility                 |
| [logging-guidelines.md](docs/guidelines/logging-guidelines.md)       | Pino setup, levels, redaction, request context                                 |
| [email-guidelines.md](docs/guidelines/email-guidelines.md)           | `IEmailProvider` contract, Mailpit and Resend implementations, templates       |
| [nest-auth-guidelines.md](docs/guidelines/nest-auth-guidelines.md)   | `BymaxAuthModule.registerAsync`, repositories, hooks, guards, frontend wiring  |
| [testing-guidelines.md](docs/guidelines/testing-guidelines.md)       | Jest + supertest, Vitest + Testing Library, Playwright, fixtures, flake policy |
| [docker-guidelines.md](docs/guidelines/docker-guidelines.md)         | Compose v2, images, volumes, healthchecks, test stack                          |

### Cross-cutting

| Guideline                                                                        | When to read                                                   |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [monorepo-guidelines.md](docs/guidelines/monorepo-guidelines.md)                 | pnpm workspace, packages, root scripts                         |
| [environment-guidelines.md](docs/guidelines/environment-guidelines.md)           | Env schema, secrets, per-environment matrices                  |
| [observability-guidelines.md](docs/guidelines/observability-guidelines.md)       | Logs vs audit vs metrics, `/health`, future OTel hooks         |
| [security-privacy-guidelines.md](docs/guidelines/security-privacy-guidelines.md) | Cookies, CORS, CSP, validation, multi-tenant, crypto           |
| [lint-format-guidelines.md](docs/guidelines/lint-format-guidelines.md)           | ESLint, Prettier, Husky, lint-staged, commitlint, EditorConfig |

### Workflow

| Guideline                                            | When to read                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| [coding-style.md](docs/guidelines/coding-style.md)   | Codebase style + mandatory code documentation policy                 |
| [git-workflow.md](docs/guidelines/git-workflow.md)   | Branches, commits, PRs, reverts — and the "no commit by agents" rule |
| [pr-review.md](docs/guidelines/pr-review.md)         | Reviewer and author checklists                                       |
| [agent-handoff.md](docs/guidelines/agent-handoff.md) | Template + rules for dispatching work between agents                 |

### Phase plans and tasks

- [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) — 20-phase build roadmap.
- `docs/tasks/phase-NN-*.md` — per-phase task lists, executed in order.
- `docs/decisions/` — ADRs (folder created when the first ADR lands).

### External canonical docs

Consult when project guidelines don't answer a specific API question.

- NestJS 11: https://docs.nestjs.com
- Next.js 16: https://nextjs.org/docs
- React 19: https://react.dev
- TypeScript 6: https://www.typescriptlang.org/docs
- Prisma 7: https://www.prisma.io/docs
- PostgreSQL 18: https://www.postgresql.org/docs/18/
- Redis 7 / ioredis: https://redis.io/docs, https://ioredis.readthedocs.io
- Tailwind 4: https://tailwindcss.com/docs
- shadcn/ui: https://ui.shadcn.com
- React Hook Form: https://react-hook-form.com
- Zod 4: https://zod.dev
- Pino: https://getpino.io
- Jest: https://jestjs.io
- Vitest: https://vitest.dev
- Playwright: https://playwright.dev
- Docker Compose: https://docs.docker.com/compose
- ESLint flat config: https://eslint.org/docs/latest/use/configure/configuration-files

---

**Consistency, library fidelity, security, and documentation are non-negotiable. When conventions conflict, security and library fidelity win.**
