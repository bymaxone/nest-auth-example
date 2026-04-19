# Security & Privacy Guidelines

This reference app demonstrates authentication, which means it sits right on the critical security path. Every decision here is conservative by default; loosening one requires an ADR.

- **Threat model**: hostile user, hostile co-tenant, curious insider, supply-chain.
- **Sources of truth**: `@bymax-one/nest-auth` (auth semantics), this repo (wiring).
- **Related**: [nest-auth-guidelines.md](nest-auth-guidelines.md), [environment-guidelines.md](environment-guidelines.md), [observability-guidelines.md](observability-guidelines.md).

---

## When to read this

Before touching authentication flows, cookies, CORS, secrets, user data, rate limiting, encryption at rest, TLS configuration, the audit pipeline, CSP headers, or any code that accepts external input.

---

## Non-negotiables

1. **Secrets never live in the repo.** `.env` is gitignored; `.env.example` carries shape only.
2. **Cookies are always HttpOnly.** `secure: true` in any non-dev environment. `sameSite: 'lax'` by default; `'strict'` if no OAuth flows need cross-site POST.
3. **CORS allowlist of one.** `origin: WEB_ORIGIN` in the primary deploy; multi-origin requires an ADR and a risk review.
4. **Global validation pipe** blocks unknown fields on every request (`whitelist: true`, `forbidNonWhitelisted: true`).
5. **RBAC enforced via the library's guards**, never by hand-rolled checks.
6. **`JwtAuthGuard`, `UserStatusGuard`, `MfaRequiredGuard`, `RolesGuard`** are registered **in that order** as global guards. Reordering is an ADR-level decision.
7. **Multi-tenant isolation** — `tenantId` on every row that represents a user-facing resource; every query scopes by it; the tenant resolver is the only trusted source.
8. **Audit every lifecycle event** via `IAuthHooks` into `audit_logs`. Non-blocking — a write failure must not block authentication.
9. **Rate limit** at the edge with `@nestjs/throttler`; the library's brute-force counter is separate and stacks on top.
10. **Never log sensitive data.** Pino `redact` paths + careful log calls. Assume every line ends up in the incident channel.

---

## Cookie configuration

```ts
cookies: {
  secure: config.get('NODE_ENV') === 'production',
  sameSite: 'lax',
  resolveDomains: resolveCookieDomains(config),
  hasSessionCookieName: 'has_session',
}
```

- `access_token` — JWT, HttpOnly, `path: /`, short-lived (15 min).
- `refresh_token` — HttpOnly, `path: /auth`, long-lived (14 days), rotated on every refresh.
- `has_session` — **non-HttpOnly** boolean flag for the edge proxy and `useAuthStatus()` to check without exposing JWT contents. Never set any other cookie to non-HttpOnly.
- Domain policy via `resolveDomains`: same apex domain for `apps/api` and `apps/web` → cookies travel correctly. Document in `docs/DEPLOYMENT.md`.

---

## CORS

```ts
app.enableCors({
  origin: config.getOrThrow('WEB_ORIGIN'),
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-Tenant-Id', 'X-Request-Id'],
});
```

- **`credentials: true`** is mandatory for cookie-mode JWT. Do not relax `origin` to compensate.
- Add origins via env (`WEB_ORIGIN` array support) + a deliberate refactor — never with `origin: true`.

---

## Rate limiting & brute force

- `@nestjs/throttler` sets per-route caps (`AUTH_THROTTLE_CONFIGS` from the library).
- The library's `bruteForce` counter locks accounts after N failures within a window (configured in `auth.module.ts`).
- **Never** remove rate limits from auth routes to "debug"; instrument instead.

---

## CSRF

Cookie-mode JWT on a **same-origin deploy** with `SameSite=Lax` is CSRF-resilient for GET-triggered actions. For POST/PATCH/DELETE cross-origin cases:

- Require the tenant header (`X-Tenant-Id`) — a custom header forces a preflight, which browsers won't send from cross-site without CORS permission.
- For the web app's own handlers (`route.ts`), rely on same-origin + `SameSite=Lax`.
- Do not add a CSRF token in this reference; document the decision in an ADR if you change that.

---

## CSP and response headers

Set via Next.js headers in `apps/web/next.config.ts` and via `helmet` (Nest) for `apps/api`. Not wired in phase 0; add in the hardening pass. Target:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (prod only).
- `Content-Security-Policy` — `default-src 'self'`, `script-src 'self' 'unsafe-inline'` only while Next.js inline scripts require it, `img-src 'self' data:`, `connect-src 'self' https://api.<domain>`.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=()`.

Document any relaxation in an ADR.

---

## Encryption

- **At rest**: Postgres disk encryption at the platform level (cloud provider default). `mfaSecret` is additionally encrypted by the library using `MFA_ENCRYPTION_KEY` (32-byte base64).
- **In transit**: TLS everywhere. Local dev uses HTTP for convenience; the cookie's `secure: false` is bounded by `NODE_ENV === 'development'`.
- **Never invent crypto.** Use `node:crypto` primitives or the library's helpers.

---

## Input validation

- DTOs (`class-validator`) + Zod at boundaries. See [validation-guidelines.md](validation-guidelines.md).
- File uploads (future phase): always whitelist MIME and file size, store outside the web root, scan before persisting.
- Deep-link params: parse via Zod inside the route handler, never concatenate into SQL or HTML.
- HTML emails: escape every dynamic value (see [email-guidelines.md](email-guidelines.md)).

---

## Multi-tenant isolation

- `tenantIdResolver` reads only from the `X-Tenant-Id` header. Anything else (host header, path param) is ADR territory.
- Every repository method accepts `tenantId` and includes it in the `where` clause. `findUnique({ id })` without a tenant filter is a bug.
- Prisma composite uniques (`@@unique([tenantId, email])`) prevent cross-tenant collisions at the DB layer.
- **Never** allow a user to specify an arbitrary `tenantId` in a body. The header is the source; the user's membership in that tenant is verified by the library's guards.

---

## Privilege boundaries

- **Public** routes require `@Public()` — explicit, auditable.
- **Authenticated** routes are the default.
- **Role-gated** routes declare `@Roles(...)`. Hierarchy (`owner ▷ admin ▷ member`) is set once, in `auth.module.ts`.
- **Platform admin** lives on `/platform` with its own JWT context and a dedicated guard (`JwtPlatformGuard`). Never share tokens across contexts.
- **Account status** — `UserStatusGuard` blocks `suspended`, `locked`, `deleted`. Flip the flag in code, never mutate `status` in a raw SQL update.

---

## Supply chain

- Lockfile-committed pnpm workspace — no `npm install` / `yarn install`.
- `pnpm audit` in CI; failures block merges. Temporary exceptions require an ADR with an expiry.
- Third-party images: SHA digest pinning (e.g., Mailpit) — see [docker-guidelines.md](docker-guidelines.md).
- Do not add a dependency "just to clean up three lines of code." Every new dep is attack surface.

---

## Logging & privacy

- Redaction paths cover the obvious keys (see [logging-guidelines.md](logging-guidelines.md)).
- Never include request bodies in logs; they can contain credentials.
- Error traces are logged at the `error` level with the `err` serializer — do not strip fields by accident.
- Emails, names, and display names are **not** secret but are **personal** — avoid logging them outside audit rows.

---

## Incident readiness

- `audit_logs` is the forensic record.
- Every deployment stamps the image with a `git_sha` env var so logs can be correlated with code.
- `/health` exposes dependency status without leaking versions in unauthenticated responses — keep response body small.
- Post-incident reviews live in `docs/decisions/` as ADRs when they change policy, or in the company incident tracker otherwise.

---

## LGPD / GDPR surface

- Users are entities in a DB. Implement a complete "delete my data" flow — deletes `users`, anonymizes `audit_logs` by replacing `actorId` with a tombstone, drops sessions, OTPs, and refresh tokens from Redis.
- Export endpoint returns the user's rows from `users`, `audit_logs` (filtered), and any domain tables scoped to them — as a single JSON blob.
- Document retention windows in `docs/DEPLOYMENT.md`.

---

## Common pitfalls

1. **`secure: false` in production** — tokens travel in plaintext. Derive `secure` from `NODE_ENV`.
2. **CORS `origin: '*'` + `credentials: true`** — browsers reject this; the workaround is always `origin: WEB_ORIGIN`.
3. **Custom auth check inside a controller** — bypasses guard ordering, dodges audit. Use `@Roles()`.
4. **Silent catch in a hook** — the audit row goes missing. Always log the failure.
5. **Per-tenant "God" role** — the hierarchy must be finite. No admin escalation via a "superowner".
6. **Shared `JWT_SECRET` across environments** — a leak in dev = a compromise of prod. Distinct secrets per env; rotate on rollover.
7. **Reading `process.env` at runtime** — typos become `undefined`, landing on silent defaults. Centralize through `ConfigService`.
8. **Bypassing validation** (`@Body() body: any`) — leaves XSS, injection, and mass-assignment wide open.
9. **User-controlled `tenantId`** in a body or query — always take it from the header via the resolver.
10. **`pnpm audit --fix` blindly** — automatic major bumps often move to unsupported APIs. Review each bump.

---

## References

- `@bymax-one/nest-auth` security chapter (library README)
- OWASP Top 10: https://owasp.org/Top10/
- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
- MDN SameSite cookies: https://developer.mozilla.org/docs/Web/HTTP/Headers/Set-Cookie/SameSite
- Helmet: https://helmetjs.github.io
- Library wiring: [nest-auth-guidelines.md](nest-auth-guidelines.md)
