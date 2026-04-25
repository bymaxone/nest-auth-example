# Architecture — nest-auth-example

High-level notes on cross-cutting design decisions. See [OVERVIEW.md](OVERVIEW.md) for the full feature breakdown and [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for the build roadmap.

---

## Platform vs Dashboard: auth scoping

The application maintains two completely independent authentication contexts in the same browser:

| Aspect        | Tenant dashboard                                               | Platform admin                   |
| ------------- | -------------------------------------------------------------- | -------------------------------- |
| Cookie scope  | Set by `@bymax-one/nest-auth` with tenant-session cookie names | — (not used)                     |
| Token storage | `HttpOnly` cookies (handled by the library)                    | `sessionStorage` (bearer tokens) |
| Guard         | `JwtAuthGuard` / tenant context                                | `JwtPlatformGuard`               |
| Login route   | `POST /api/auth/login`                                         | `POST /api/auth/platform/login`  |
| Header used   | Cookie header (automatic)                                      | `Authorization: Bearer <token>`  |

**Why bearer + sessionStorage for the platform?**

The `@bymax-one/nest-auth` library's `JwtPlatformGuard` reads tokens from the `Authorization: Bearer` header, not from cookies. The login response returns `{ accessToken, refreshToken, admin }` in the JSON body (not `Set-Cookie`). Storing these tokens in `sessionStorage` keeps them out of cookies (no cross-context collision risk) and means they are automatically cleared when the browser tab is closed.

**Proxy middleware (Next.js)**

The Next.js proxy (`proxy.ts`) can only verify cookie-based JWTs. It cannot inspect bearer tokens from `sessionStorage`. Therefore, `/platform/tenants` and `/platform/users` are listed as `publicRoutes` in the proxy — the proxy passes requests through without cookie checks. The real authorization gate is `JwtPlatformGuard` on the NestJS controller, which verifies the `Authorization: Bearer` header on every request.

Client-side guarding is done in `app/platform/shell.tsx` — a client component that reads `sessionStorage` on mount and redirects to `/platform/login` if no access token is found. This prevents the "flash of unauthenticated content" without leaking token values to the server.

**Coexistence**

A user can be simultaneously:

- Logged in as a tenant member (cookies set by the library), and
- Logged in as a platform admin (bearer token in `sessionStorage`).

The two contexts do not interfere. Visiting `/platform/login` always shows the form regardless of tenant session state (the two are orthogonal).

---

## Multi-tenancy

Every tenant-scoped row carries a `tenantId` column. All API queries scope by `tenantId`. The `tenantIdResolver` reads only from the `X-Tenant-Id` request header (a CUID, not a slug). Cross-tenant data access is a bug, not a feature.

---

## WebSocket authentication

WebSocket connections authenticate via a `Bearer` token passed in the connection query string (`?token=<accessToken>`). The gateway (`NotificationsGateway`) validates the token using the same JWT secret as the REST guards, and additionally checks a Redis revocation key (`rv:{jti}`) to catch tokens that were invalidated mid-flight (e.g., after a password change or session revocation).
