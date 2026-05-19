# Troubleshooting

Common first-run errors mapped to fixes. **Search this page by the exact error message** (Ctrl/Cmd-F), or scan the section that matches where it broke. Each entry is symptom → cause → fix → related docs.

---

## Setup & install

### `Cannot find module '@bymax-one/nest-auth'`

- **Symptom.** The API or web build fails to resolve the library, or imports from `@bymax-one/nest-auth/server` etc. are red.
- **Cause.** The local `pnpm link` to the sibling `../nest-auth` checkout is missing or stale (the library was not built, or was rebuilt without the example noticing).
- **Fix.**
  1. Ensure the library is checked out next to this repo at `../nest-auth`.
  2. Run `scripts/link-library.sh` from the repo root — it builds the library and re-establishes the global link.
  3. Reinstall if needed: `pnpm install`.
- **See also.** [Getting started](./GETTING_STARTED.md#prerequisites).

### Web build fails to resolve library subpath exports

- **Symptom.** `next dev` errors resolving `@bymax-one/nest-auth/react` (or `/nextjs`, `/client`) subpaths.
- **Cause.** Turbopack cannot resolve the library's subpath `exports` map.
- **Fix.** Run the web app with webpack — this is already wired (`next dev --webpack` / `next build --webpack` in [`apps/web/package.json`](../apps/web/package.json)). Do not switch the dev/build scripts to Turbopack.

---

## Configuration & environment

### `JWT_SECRET must be at least 64 characters`

- **Symptom.** The API aborts at boot with this Zod message (or the low-entropy variant).
- **Cause.** `JWT_SECRET` is missing, too short, or a low-entropy placeholder.
- **Fix.** Generate one and set it in `apps/api/.env`, then mirror the **same value** into the web app's `AUTH_JWT_SECRET_FOR_PROXY`:
  ```bash
  openssl rand -hex 64
  ```
- **See also.** [Environment](./ENVIRONMENT.md), [generating secrets](./ENVIRONMENT.md#generating-secrets).

### `MFA_ENCRYPTION_KEY must decode to exactly 32 bytes`

- **Symptom.** API aborts at boot.
- **Cause.** The key is not base64, or does not decode to 32 bytes.
- **Fix.** `openssl rand -base64 32` and set `MFA_ENCRYPTION_KEY`.

### `WEB_ORIGIN must use https:// in production` / `EMAIL_PROVIDER=mailpit is not allowed in production`

- **Symptom.** Production boot aborts.
- **Cause.** Production refinements in the env schema reject dev-only values.
- **Fix.** Use an `https://` `WEB_ORIGIN`, set `EMAIL_PROVIDER=resend` with a valid `RESEND_API_KEY`.
- **See also.** [Production refinements](./ENVIRONMENT.md#production-refinements), [deployment](./DEPLOYMENT.md).

---

## Runtime — API

### `blocked by CORS policy` / preflight rejection

- **Symptom.** Browser network tab shows a failed `OPTIONS` preflight or a CORS error on `/api/*` calls.
- **Cause.** The request `Origin` does not exactly match `WEB_ORIGIN`, or a custom header is not allowlisted.
- **Fix.** Set `WEB_ORIGIN` to the exact browser origin (`http://localhost:3000` in dev). CORS allows `credentials` and the `Content-Type`, `X-Tenant-Id`, `X-Request-Id` headers — see [`main.ts`](../apps/api/src/main.ts).

### `Missing or invalid x-tenant-id header`

- **Symptom.** API returns 500/400 on a tenant-scoped request.
- **Cause.** The request reached a tenant route without the `X-Tenant-Id` header. The resolver reads **only** that header.
- **Fix.** Send `X-Tenant-Id: <tenant cuid>`. Grab a tenant id from the seed banner (it prints `acme`/`globex` cuids). On the login page, pass `?tenantId=<cuid>`.
- **See also.** [Features — multi-tenant isolation](./FEATURES.md), [database — Tenant](./DATABASE.md#tenant--isolation-boundary-app-owned).

### `ECONNREFUSED 127.0.0.1:1025` (Mailpit) / emails not sending

- **Symptom.** Sending an email throws a connection error.
- **Cause.** The local infrastructure (Mailpit) is not running.
- **Fix.** `pnpm infra:up`, then confirm with `docker ps` that `mailpit` is healthy. The UI is at [http://localhost:8025](http://localhost:8025).

### `EADDRINUSE: address already in use :::4000` (or `:3000`)

- **Symptom.** The API or web dev server fails to start.
- **Cause.** A previous dev server is still bound to the port.
- **Fix.** Find and stop it: `lsof -i :4000` then `kill <pid>` (likewise for `:3000`).

---

## Runtime — web

### Cookies not sticking / user appears logged out after login on `localhost`

- **Symptom.** Login succeeds but the session is not recognised on the next request.
- **Cause.** Cross-origin cookie loss, a `Secure` cookie over plain HTTP, or a mis-set API base.
- **Fix.**
  1. Keep calls same-origin: `NEXT_PUBLIC_API_URL=http://localhost:3000/api` (the web app proxies to the API).
  2. Ensure `INTERNAL_API_URL=http://localhost:4000` — **no `/api` suffix**.
  3. Keep `NODE_ENV=development` locally so cookies are not marked `Secure`.
- **See also.** [Architecture — cookie lifecycle](./ARCHITECTURE.md), [environment](./ENVIRONMENT.md).

---

## Tests

### e2e suite fails connecting to Postgres on `:55432`

- **Symptom.** `prisma migrate deploy` or supertest specs fail to connect.
- **Cause.** The ephemeral test stack is not up.
- **Fix.** `pnpm infra:test:up`. The `pretest:e2e` script runs `prisma migrate deploy` against `DATABASE_URL_TEST`; the stack must be running first.

---

## Database

### `prisma migrate` vs `db push`

- **Symptom.** Schema changes are lost, or environments drift.
- **Cause.** Using `prisma db push` (schema sync, no history) instead of migrations.
- **Fix.** Always use migrations:
  - Local: `pnpm --filter @nest-auth-example/api prisma:migrate` (`prisma migrate dev`).
  - CI/prod: `pnpm --filter @nest-auth-example/api prisma:migrate:deploy` (`prisma migrate deploy`).
- **See also.** [Database — migrations](./DATABASE.md#migrations).

---

## Still stuck?

Open an issue at [the project tracker](https://github.com/bymaxone/nest-auth-example/issues) with the exact error, your OS, Node and pnpm versions, and whether the infra containers are healthy (`docker ps`).
