# Getting Started

> **Note:** This document is a stub created in Phase 9. The full quickstart guide
> (Phase 18) will expand this into a complete 5-minute walkthrough covering all
> prerequisites, clone steps, Docker setup, migration, and first login.

---

## Prerequisites

- Node.js ≥ 24 (`.nvmrc` pins the version — `nvm use` is sufficient)
- pnpm ≥ 10.8 (`npm install -g pnpm@latest`)
- Docker Compose v2 (`docker compose version`)
- The sibling `nest-auth` library checkout at `../nest-auth` (see [OVERVIEW.md §7](OVERVIEW.md))

---

## Quick start

```bash
# 1. Link the library (sibling checkout must be built first)
bash scripts/link-library.sh

# 2. Install workspace dependencies
pnpm install

# 3. Start infrastructure (Postgres, Redis, Mailpit)
pnpm infra:up

# 4. Run migrations + seed
pnpm --filter @nest-auth-example/api prisma:migrate dev
pnpm --filter @nest-auth-example/api prisma:seed

# 5. Start the API and web app
pnpm dev
```

The API is available at `http://localhost:4000/api/health`.
The web app is available at `http://localhost:3000`.
Mailpit UI (captured dev emails) is at `http://localhost:8025`.

---

## Seeded accounts

> **WARNING: DEV ONLY.** These credentials are publicly documented and must never be
> used in any staging or production environment.

### Tenant users (password: `Passw0rd!Passw0rd`)

| Email                       | Role   | Tenant |
| --------------------------- | ------ | ------ |
| `owner.acme@example.com`    | OWNER  | acme   |
| `admin.acme@example.com`    | ADMIN  | acme   |
| `member.acme@example.com`   | MEMBER | acme   |
| `viewer.acme@example.com`   | VIEWER | acme   |
| `owner.globex@example.com`  | OWNER  | globex |
| `admin.globex@example.com`  | ADMIN  | globex |
| `member.globex@example.com` | MEMBER | globex |
| `viewer.globex@example.com` | VIEWER | globex |

All tenant users have `emailVerified: true` and `status: ACTIVE`.

The `X-Tenant-Id` header must be the tenant's **database ID** (a cuid), not the slug.
Run `pnpm --filter @nest-auth-example/api prisma:seed` to see the IDs printed in the
credentials banner, or call `GET /api/platform/tenants` with a platform admin token.

### Platform admin (FCM #22 — Phase 9)

> **WARNING: DEV ONLY.** The platform admin context bypasses tenant scoping.

| Field    | Value                                            |
| -------- | ------------------------------------------------ |
| Email    | `platform@example.dev`                           |
| Password | `PlatformPassw0rd!`                              |
| Role     | `SUPER_ADMIN`                                    |
| Login    | `POST /api/auth/platform/login` (no X-Tenant-Id) |

A second platform user (`platform@example.com`, password `Passw0rd!Passw0rd`) is
also seeded as a generic `SUPER_ADMIN` for historical compatibility.

---

## Environment variables

Copy `.env.example` to `apps/api/.env` and fill in the required values.
A full variable reference will be documented in `ENVIRONMENT.md` (Phase 18).

| Variable             | Example value                                             | Notes                |
| -------------------- | --------------------------------------------------------- | -------------------- |
| `DATABASE_URL`       | `postgres://postgres:postgres@localhost:5432/example_app` | From Docker Compose  |
| `REDIS_URL`          | `redis://localhost:6379`                                  | From Docker Compose  |
| `JWT_SECRET`         | _(run `openssl rand -hex 64`)_                            | Must be ≥ 64 chars   |
| `MFA_ENCRYPTION_KEY` | _(run `openssl rand -base64 32`)_                         | 32-byte base64       |
| `EMAIL_PROVIDER`     | `mailpit`                                                 | Use `resend` in prod |
| `SMTP_HOST`          | `localhost`                                               | Mailpit SMTP         |
| `SMTP_PORT`          | `1025`                                                    | Mailpit SMTP         |
| `WEB_ORIGIN`         | `http://localhost:3000`                                   | CORS allowed origin  |

---

## Running tests

```bash
# Start the test stack (different ports from dev — safe to run alongside)
pnpm infra:test:up

# Unit tests
pnpm --filter @nest-auth-example/api test

# E2e tests (supertest, requires test stack)
pnpm --filter @nest-auth-example/api test:e2e
```

---

## Stopping infrastructure

```bash
pnpm infra:down     # stops containers
# Or with volume cleanup:
docker compose down -v
```
