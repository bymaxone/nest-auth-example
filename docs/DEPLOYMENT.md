# Deployment

Production checklist for shipping `nest-auth-example` (and apps built on the same pattern). Expands [OVERVIEW §14](./OVERVIEW.md). Work top to bottom; the [release checklist](#release-checklist) at the end is copy-pasteable into a PR template.

---

## Target topology

Two independently deployable services that talk over JSON/HTTP, with all session state in HttpOnly cookies — no shared in-process state.

- **`apps/api`** → any Node ≥ 24 host or container (Fly.io, Railway, ECS, Kubernetes). Needs PostgreSQL 18 and Redis 7.
- **`apps/web`** → Vercel, Netlify, or self-hosted Node. Talks to the API via `INTERNAL_API_URL` (server-side) and proxies the browser through same-origin `/api`.

Build production images with the multi-stage, non-root Dockerfiles introduced in Phase 19; reproduce the topology locally with `docker-compose.prod.yml` for smoke tests.

---

## Production smoke test (local)

Before shipping a release, reproduce the full production topology on a local machine:

```bash
# 1. Pull the release images (or build them locally first — see Dockerfiles).
docker compose -f docker-compose.prod.yml pull

# 2. Copy the example env file and fill in real secrets.
cp .env.prod.example .env.prod
# Edit .env.prod: set POSTGRES_PASSWORD, JWT_SECRET, MFA_ENCRYPTION_KEY,
# AUTH_JWT_SECRET_FOR_PROXY, WEB_ORIGIN, RESEND_API_KEY, etc.

# 3. Start all four services (postgres, redis, api, web) and wait for health.
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --wait

# 4. Apply database migrations (run once per release or whenever schema changes).
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec api node_modules/.bin/prisma migrate deploy

# 5. Verify the stack is healthy.
curl -sf http://localhost:4000/api/health | jq .
# Expect: { "status": "ok", "deps": { "postgres": "ok", "redis": "ok" } }
curl -sf -o /dev/null -w "%{http_code}" http://localhost:3000
# Expect: 200

# 6. Tear down when done.
docker compose -f docker-compose.prod.yml --env-file .env.prod down
```

> **Note on migrations.** `prisma` is a devDependency and is not in the production image. Run migrations as a pre-deploy step using the workspace CLI (on the deploy host) or via a separate migration container that has the full workspace available. Never rely on the app container to self-migrate — the app will fail to start if applied migrations are missing.

---

## Cookies

The library issues `access_token`, `refresh_token`, and `has_session` cookies. In production ([`auth.config.ts`](../apps/api/src/auth/auth.config.ts)):

- **`HttpOnly`** on the token cookies — never readable from JS.
- **`Secure`** — driven by `secureCookies: isProduction`. Requires HTTPS end-to-end.
- **`SameSite=Lax`** — the default. Use `Strict` only if you do not need the OAuth callback POST.
- **`refreshCookiePath: '/api/auth'`** — the refresh cookie is scoped to the refresh route so it is not sent on every request.
- **Domain** — set `PUBLIC_DOMAIN` to enable `cookies.resolveDomains`, which sets the cookie `Domain` to `.<PUBLIC_DOMAIN>` so it is valid across sub-domains.

Cookie strategy by deployment shape:

| Layout                                                          | Cookie domain                                | Notes                                                                   |
| --------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| Same registrable domain (`app.example.com` + `api.example.com`) | `PUBLIC_DOMAIN=example.com` → `.example.com` | Cookies travel between sub-domains. `SameSite=Lax`.                     |
| Single origin (web proxies API under `/api`)                    | host-only (leave `PUBLIC_DOMAIN` unset)      | Simplest; what local dev uses.                                          |
| Cross-site (different registrable domains)                      | not supported by `Lax`                       | Avoid — would require `SameSite=None; Secure` and weakens CSRF posture. |

---

## HTTPS & HSTS

- Terminate TLS in front of both services. The env schema **rejects a non-`https://` `WEB_ORIGIN` in production**.
- `apps/api` sends security headers via Helmet ([`main.ts`](../apps/api/src/main.ts)) — `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `hidePoweredBy` — before any route responds. `Strict-Transport-Security` is enabled automatically by Helmet when `NODE_ENV=production`.
- `apps/web` sends security headers via the `headers()` block in [`next.config.mjs`](../apps/web/next.config.mjs):

| Header                      | Value                                                                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `X-Content-Type-Options`    | `nosniff`                                                                                                                                                                               |
| `X-Frame-Options`           | `DENY`                                                                                                                                                                                  |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                                                                                                                                       |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (production only)                                                                                                                                 |
| `Content-Security-Policy`   | `default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' <API> <WS>; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'` |

- Serve `apps/web` over HTTPS too, and set `NEXT_PUBLIC_WS_URL` to `wss://…`.

---

## JWT secret rotation

Tokens are signed HS256 with `JWT_SECRET`. Rotate on a schedule. The library supports **rolling secrets** via `jwt.previousSecrets`: new tokens are signed with the primary `secret`, while tokens signed with a recently-retired secret still verify during a grace window.

This example currently sets a single `jwt.secret` in [`auth.config.ts`](../apps/api/src/auth/auth.config.ts). To rotate without logging everyone out:

1. Generate a new secret: `openssl rand -hex 64`.
2. Move the **current** secret into `jwt.previousSecrets: [oldSecret]` and set the new one as `jwt.secret`.
3. Deploy. Existing access tokens (15-minute lifetime) keep verifying against `previousSecrets` until they expire.
4. After the access-token lifetime has elapsed for all sessions, drop the old secret from `previousSecrets` in a follow-up deploy.
5. Update the web app's `AUTH_JWT_SECRET_FOR_PROXY` to the **new** primary in the same rollout — the edge proxy verifies access cookies with it.

---

## Redis persistence

Sessions, refresh tokens, OTPs, brute-force counters, and the revocation blacklist all live in Redis (see [redis](./REDIS.md)).

- Enable **`appendonly yes`** so the keyspace survives a restart.
- Losing Redis forces logouts (everyone re-authenticates) but causes **no data loss** — durable data is in Postgres.
- Size `maxmemory` for the working set and use an eviction policy that does **not** silently drop live keys (`volatile-lru` only works because the library sets TTLs on everything).

---

## Email DNS

When `EMAIL_PROVIDER=resend` (see [email](./EMAIL.md)):

- `SMTP_FROM` must be a **verified** sender in Resend.
- Publish **SPF**, **DKIM**, and **DMARC** records for the sending domain. Missing records mean spam-foldering or hard bounces.
- Keep `RESEND_API_KEY` in the platform secret store.

---

## Logging & audit shipping

- `apps/api` logs structured JSON via Pino, with `requestId` and `tenantId` on every line and redaction for secrets. Ship stdout to your log aggregator.
- The append-only `AuditLog` table records every auth lifecycle event ([`app-auth.hooks.ts`](../apps/api/src/auth/app-auth.hooks.ts)). Stream it to your SIEM for retention and alerting. It never contains tokens, hashes, or OTPs.

---

## Health checks

- **API** — `GET /api/health` returns `{ status, uptime, version, deps: { postgres, redis, library } }`. Wire it to your orchestrator's liveness/readiness probes; treat a non-`ok` `deps` entry as unhealthy.
- **Web** — a lightweight liveness route for the platform's health check.

---

## Rollout strategy

- Run database migrations with `prisma migrate deploy` (never `db push`) as a pre-deploy step — see [database](./DATABASE.md#migrations).
- Deploy the API before the web app when the API ships new routes the web depends on.
- Roll forward with health-gated, rolling deploys; keep the previous image for fast rollback.

---

## Release checklist

```text
[ ] JWT_SECRET is 64+ hex chars, unique to this environment, in the secret store
[ ] AUTH_JWT_SECRET_FOR_PROXY equals the API JWT_SECRET
[ ] MFA_ENCRYPTION_KEY is a base64 32-byte value in the secret store
[ ] NODE_ENV=production (enables Secure cookies + production refinements)
[ ] WEB_ORIGIN is https:// and matches the real browser origin
[ ] PUBLIC_DOMAIN set if API and web are on different sub-domains
[ ] EMAIL_PROVIDER=resend with a valid RESEND_API_KEY
[ ] SMTP_FROM verified in Resend; SPF + DKIM + DMARC published
[ ] DATABASE_URL points at the production Postgres; migrations applied via migrate deploy
[ ] REDIS_URL points at a persistent Redis (appendonly yes)
[ ] TLS terminated for both services; HSTS confirmed in response headers
[ ] NEXT_PUBLIC_API_URL is same-origin (/api); INTERNAL_API_URL has no /api suffix
[ ] NEXT_PUBLIC_WS_URL uses wss://
[ ] GET /api/health returns ok for postgres, redis, and library
[ ] Audit logs shipping to the SIEM; app logs shipping to the aggregator
[ ] Rollback image identified; migration is backward-compatible with the previous release
[ ] OAuth (if enabled): callback URL registered with Google and reachable over HTTPS
```

---

## Further reading

- [Environment](./ENVIRONMENT.md) — every variable and its production constraints.
- [Email](./EMAIL.md) — provider swap and DNS detail.
- [Redis](./REDIS.md) — persistence and key lifetimes.
- [Troubleshooting](./TROUBLESHOOTING.md) — production boot-time validation errors.
