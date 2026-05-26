# Getting started

From a clean clone to **logged in as `admin.acme@example.com`** in about five minutes. Every command below matches the scripts in the repo; if anything fails, jump to [common snags](#common-snags).

---

## Prerequisites

- **Node.js ≥ 24** — `.nvmrc` pins the version, so `nvm use` is enough.
- **pnpm ≥ 10.8** — `npm install -g pnpm@latest`.
- **Docker Compose v2** — verify with `docker compose version`.

That's it. `@bymax-one/nest-auth` is consumed from npm — no sibling checkout required. (Working on the library and the example at the same time? See [OVERVIEW §7](./OVERVIEW.md#7-library-consumption) for the `pnpm link` workflow.)

---

## Quick start

```bash
# 1. Install workspace dependencies (pulls @bymax-one/nest-auth from npm)
pnpm install

# 2. Start infrastructure (Postgres, Redis, Mailpit) and wait for health
pnpm infra:up

# 3. Create the API env file, then generate the two secrets it needs
cp .env.example apps/api/.env
#   JWT_SECRET=$(openssl rand -hex 64)         AUTH_JWT_SECRET_FOR_PROXY = same value
#   MFA_ENCRYPTION_KEY=$(openssl rand -base64 32)

# 4. Apply migrations and seed demo data
pnpm --filter @nest-auth-example/api prisma:migrate
pnpm --filter @nest-auth-example/api prisma:seed

# 5. Start the API and web app together
pnpm dev
```

When `pnpm dev` is up:

- Web app → **http://localhost:3000**
- API health → **http://localhost:4000/api/health** (should report `postgres`, `redis`, and `library` all `ok`)
- Mailpit (captured dev emails) → **http://localhost:8025**

> Need every variable explained? See [environment](./ENVIRONMENT.md). Want the big picture first? See [architecture](./ARCHITECTURE.md).

---

## First login

1. Open **http://localhost:3000/auth/login?tenantId=acme** (the `tenantId` query lets the page resolve the `acme` slug to its tenant id).
2. Sign in with **`admin.acme@example.com`** / **`Passw0rd!Passw0rd`**.
3. You land on the dashboard — session active, identity verified.

![Logged in to the dashboard](./assets/getting-started/login-success.png)

Trigger an email (e.g. **forgot password**, or register a new user) and watch it arrive in Mailpit at **http://localhost:8025** — nothing is sent externally in development.

![Mailpit inbox capturing transactional emails](./assets/getting-started/mailpit.png)

---

## Seeded credentials

> **DEV ONLY.** These are publicly documented — never use them in staging or production.

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

All are `emailVerified: true` and `status: ACTIVE`. Two extra e2e users (`admin@example.dev`, `member@example.dev`) also exist in `acme`.

The `X-Tenant-Id` header must be the tenant's **database id** (a cuid), not the slug. The seed prints the ids in a banner; or query them:

```bash
docker exec nest-auth-example-postgres-1 psql -U postgres -d example_app \
  -c 'SELECT slug, id FROM "Tenant";'
```

### Platform admin

> **DEV ONLY.** The platform context bypasses tenant scoping.

| Field    | Value                                |
| -------- | ------------------------------------ |
| Login    | http://localhost:3000/platform/login |
| Email    | `platform@example.dev`               |
| Password | `PlatformPassw0rd!`                  |
| Role     | `SUPER_ADMIN`                        |

---

## Common snags

A few first-run issues and where to fix them — full list in [troubleshooting](./TROUBLESHOOTING.md):

1. **`JWT_SECRET must be at least 64 characters`** — regenerate with `openssl rand -hex 64` and set the same value as `AUTH_JWT_SECRET_FOR_PROXY`. See [troubleshooting → JWT_SECRET](./TROUBLESHOOTING.md#jwt_secret-must-be-at-least-64-characters).
2. **`Cannot find module '@bymax-one/nest-auth'`** — your install is stale or the lockfile is out of sync. Run `pnpm install` from the repo root. See [troubleshooting → library resolution](./TROUBLESHOOTING.md#cannot-find-module-bymax-onenest-auth).
3. **Emails never arrive / `ECONNREFUSED :1025`** — the infra isn't up; run `pnpm infra:up` and confirm `docker ps`. See [troubleshooting → Mailpit](./TROUBLESHOOTING.md#econnrefused-1270011025-mailpit--emails-not-sending).

---

## Running the test suites

```bash
pnpm infra:test:up                                   # ephemeral test stack (separate ports)
pnpm --filter @nest-auth-example/api test            # unit
pnpm --filter @nest-auth-example/api test:e2e        # supertest e2e (needs the test stack)
pnpm --filter @nest-auth-example/web test:e2e        # Playwright
```

---

## Stopping the stack

```bash
pnpm infra:down       # stop containers (keep data)
pnpm infra:nuke       # stop AND delete volumes (fresh start)
```

---

## Where to go next

- [Features](./FEATURES.md) — a walkthrough of every demonstrated capability.
- [Architecture](./ARCHITECTURE.md) — how the two apps and the library fit together.
- [Environment](./ENVIRONMENT.md) — every configuration variable.
- [Database](./DATABASE.md) · [Redis](./REDIS.md) · [Email](./EMAIL.md) — the stores and transports.
- [Google OAuth](./OAUTH_GOOGLE.md) — turning the "Continue with Google" button into a working sign-in flow.
- [Deployment](./DEPLOYMENT.md) — taking it to production.
