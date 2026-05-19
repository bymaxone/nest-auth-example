# Environment variable reference

Every environment variable consumed by `nest-auth-example`, with its validation rule, default, and an example value. This document mirrors [Appendix A of the development plan](./DEVELOPMENT_PLAN.md#appendix-a--environment-variable-registry) and is reconciled against the two enforcement surfaces that actually parse the variables at boot:

- **`apps/api`** — [`apps/api/src/config/env.schema.ts`](../apps/api/src/config/env.schema.ts) (Zod, strict `ConfigService<Env, true>`).
- **`apps/web`** — [`apps/web/lib/env.ts`](../apps/web/lib/env.ts) (Zod, frozen at module load).

If a value is missing or malformed, the app **refuses to start** with a descriptive error. There is no silent `undefined`.

> The shape (with safe placeholders) also lives in [`.env.example`](../.env.example) at the repo root. Copy it to `.env` and fill it in — see [getting started](./GETTING_STARTED.md).

---

## How configuration is loaded

1. **Precedence.** Process environment variables win over `.env` files. In local development each app reads a root `.env` (and the API additionally honours `apps/api/.env`); in production the values come from the platform's secret store.
2. **Validation at boot.** `apps/api` parses `process.env` through the Zod schema during bootstrap; `apps/web` parses it at module load of `lib/env.ts`. Both throw on the first invalid value.
3. **Single access point.** Application code never reads `process.env.*` directly — the API goes through `ConfigService<Env, true>`, the web app through the `env` object exported by `lib/env.ts`. (The one documented exception is `EMAIL_PROVIDER`, read synchronously at module-decoration time in [`auth.module.ts`](../apps/api/src/auth/auth.module.ts) before the DI container exists.)
4. **`NEXT_PUBLIC_` prefix.** Only variables prefixed `NEXT_PUBLIC_` are inlined into the browser bundle. Every other web variable is server-only and is `undefined` if referenced from a client component.

---

## Shared

| Variable        | Required | Example       | Validation                                                              | Notes                                                                                                    |
| --------------- | -------- | ------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`      | ✗        | `development` | enum `development` \| `production` \| `test`; default `development`     | Drives `secureCookies`, the production refinements below, and logging.                                   |
| `LOG_LEVEL`     | ✗        | `info`        | enum `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace`; default `info` | Pino log level for `apps/api`.                                                                           |
| `PUBLIC_DOMAIN` | ✗        | `example.com` | non-empty string; optional                                              | Only effective in production; feeds `cookies.resolveDomains`. See [deployment](./DEPLOYMENT.md#cookies). |

## Docker Compose (local infrastructure only)

These are consumed by [`docker-compose.yml`](../docker-compose.yml) to provision the Postgres container — they are **not** part of either app's Zod schema. They must agree with the credentials embedded in `DATABASE_URL`.

| Variable            | Required | Example       | Notes                                        |
| ------------------- | -------- | ------------- | -------------------------------------------- |
| `POSTGRES_USER`     | ✓ (dev)  | `postgres`    | Postgres superuser created in the container. |
| `POSTGRES_PASSWORD` | ✓ (dev)  | `postgres`    | Change before any non-local use.             |
| `POSTGRES_DB`       | ✓ (dev)  | `example_app` | Database created on first container start.   |

## `apps/api`

Source of truth: [`apps/api/src/config/env.schema.ts`](../apps/api/src/config/env.schema.ts).

| Variable                     | Required        | Example                                                                         | Validation                                                   | Notes                                                                                                         |
| ---------------------------- | --------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `API_PORT`                   | ✗               | `4000`                                                                          | coerced int, `1`–`65535`; default `4000`                     | TCP port for the NestJS server.                                                                               |
| `WEB_ORIGIN`                 | ✓               | `http://localhost:3000`                                                         | URL; must be `https://` in production                        | CORS allowlist origin. The frontend's public origin.                                                          |
| `DATABASE_URL`               | ✓               | `postgresql://postgres:postgres@localhost:5432/example_app?schema=public`       | URL                                                          | Postgres connection string for the app database.                                                              |
| `DATABASE_URL_TEST`          | ✗               | `postgresql://postgres:postgres@localhost:55432/example_app_test?schema=public` | URL; optional                                                | Used by the e2e suite against the ephemeral test stack.                                                       |
| `REDIS_URL`                  | ✓               | `redis://localhost:6379`                                                        | URL                                                          | `ioredis` connection string, forwarded to the library.                                                        |
| `REDIS_NAMESPACE`            | ✗               | `nest-auth-example`                                                             | non-empty string; default `nest-auth-example`                | Key prefix shared with the library. See [redis](./REDIS.md).                                                  |
| `JWT_SECRET`                 | ✓               | _64+ hex chars_                                                                 | string, **min 64 chars**, ≥16 distinct chars (entropy guard) | HS256 signing secret. Generate with `openssl rand -hex 64`.                                                   |
| `MFA_ENCRYPTION_KEY`         | ✓               | _base64 32 bytes_                                                               | base64 string that decodes to exactly 32 bytes               | AES-256 key for TOTP secrets at rest. `openssl rand -base64 32`.                                              |
| `EMAIL_PROVIDER`             | ✗               | `mailpit`                                                                       | enum `mailpit` \| `resend`; default `mailpit`                | `mailpit` is rejected in production. See [email](./EMAIL.md).                                                 |
| `SMTP_HOST`                  | ✗               | `localhost`                                                                     | non-empty string; default `localhost`                        | Mailpit SMTP host.                                                                                            |
| `SMTP_PORT`                  | ✗               | `1025`                                                                          | coerced int; default `1025`                                  | Mailpit SMTP port.                                                                                            |
| `SMTP_FROM`                  | ✗               | `no-reply@nest-auth-example.dev`                                                | email; default `no-reply@nest-auth-example.dev`              | Sender for all outbound mail. Must be Resend-verified in production.                                          |
| `RESEND_API_KEY`             | ✓ when `resend` | `re_...`                                                                        | string; optional unless `EMAIL_PROVIDER=resend`              | Resend API key. Never commit a real key.                                                                      |
| `OAUTH_GOOGLE_CLIENT_ID`     | ✗ (pair)        | `123.apps.googleusercontent.com`                                                | string; optional                                             | Presence of both ID **and** secret enables Google OAuth.                                                      |
| `OAUTH_GOOGLE_CLIENT_SECRET` | ✗ (pair)        | `GOCSPX-...`                                                                    | string; optional                                             | Must be set together with the client ID.                                                                      |
| `OAUTH_GOOGLE_CALLBACK_URL`  | ✓ when OAuth on | `http://localhost:4000/api/auth/oauth/google/callback`                          | URL; required when OAuth is enabled                          | Redirect URI registered with Google.                                                                          |
| `PASSWORD_RESET_METHOD`      | ✗               | `token`                                                                         | enum `token` \| `otp`; default `token`                       | `token` sends a link; `otp` sends a numeric code. See [features](./FEATURES.md#6-password-reset--token-mode). |

## `apps/web`

Source of truth: [`apps/web/lib/env.ts`](../apps/web/lib/env.ts).

| Variable                           | Required | Example                     | Validation                                        | Notes                                                                                                            |
| ---------------------------------- | -------- | --------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `INTERNAL_API_URL`                 | ✓        | `http://localhost:4000`     | URL                                               | Server-to-server base used by the proxy and route handlers. **No `/api` suffix.**                                |
| `AUTH_JWT_SECRET_FOR_PROXY`        | ✓        | _same as API `JWT_SECRET`_  | string, min 32 chars                              | Lets the edge proxy verify HS256 access cookies without an API round-trip.                                       |
| `NEXT_PUBLIC_API_URL`              | ✓        | `http://localhost:3000/api` | URL                                               | Browser-visible API base (same-origin `/api` proxy).                                                             |
| `NEXT_PUBLIC_WS_URL`               | ✓        | `ws://localhost:3000`       | URL                                               | WebSocket base. Same-origin (proxied via `/ws`) so the access cookie rides the upgrade. Use `wss://` over HTTPS. |
| `NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED` | ✗        | `false`                     | enum `true` \| `false` → boolean; default `false` | Shows/hides the "Continue with Google" button.                                                                   |

> **Drift from Appendix A.** `WEB_ORIGIN`, `REDIS_NAMESPACE`, and a 64-char (not 32) `JWT_SECRET` minimum are enforced by the schema but predate or differ from the appendix; `MFA_ENCRYPTION_KEY` is always required (not "when MFA"); `NEXT_PUBLIC_WS_URL` is required and same-origin. The code is authoritative — this table follows the schema.

---

## Production refinements

`apps/api` applies these cross-field rules in `envSchema.superRefine` ([env.schema.ts](../apps/api/src/config/env.schema.ts)). Each one aborts boot in production with a descriptive message:

- `WEB_ORIGIN` **must** start with `https://` when `NODE_ENV=production`.
- `EMAIL_PROVIDER=mailpit` is rejected when `NODE_ENV=production` — use `resend`.
- `RESEND_API_KEY` is required when `EMAIL_PROVIDER=resend`.
- `OAUTH_GOOGLE_CLIENT_ID` and `OAUTH_GOOGLE_CLIENT_SECRET` must both be set or both be unset.
- `OAUTH_GOOGLE_CALLBACK_URL` is required whenever OAuth is enabled.

---

## Generating secrets

```bash
# JWT signing secret — 64 hex chars (32 bytes). Use the SAME value for the API
# JWT_SECRET and the web AUTH_JWT_SECRET_FOR_PROXY.
openssl rand -hex 64

# MFA encryption key — base64-encoded 32 bytes.
openssl rand -base64 32
```

Never reuse the example values, never commit a populated `.env`, and rotate `JWT_SECRET` on a schedule in production (see [JWT rotation](./DEPLOYMENT.md#jwt-secret-rotation)).

---

## Keeping this document in sync

This file, [`.env.example`](../.env.example), and the two Zod schemas must change together. **If you add, rename, or remove a variable, update all four in the same PR:**

1. [`apps/api/src/config/env.schema.ts`](../apps/api/src/config/env.schema.ts) and/or [`apps/web/lib/env.ts`](../apps/web/lib/env.ts) — the enforcement surface.
2. [`.env.example`](../.env.example) — the shape with placeholders.
3. This document — the human-readable reference.
4. [Appendix A](./DEVELOPMENT_PLAN.md#appendix-a--environment-variable-registry) — the canonical registry.

---

## Further reading

- [Getting started](./GETTING_STARTED.md) — where these values come from on first run.
- [Deployment](./DEPLOYMENT.md) — production values, cookie domains, and secret rotation.
- [Troubleshooting](./TROUBLESHOOTING.md) — what the boot-time validation errors mean.
- [Email](./EMAIL.md) — `EMAIL_PROVIDER` switching and the SMTP/Resend variables.
- [Redis](./REDIS.md) — `REDIS_URL` and `REDIS_NAMESPACE`.
