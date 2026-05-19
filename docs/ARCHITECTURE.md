# Architecture

How the pieces fit together: which `@bymax-one/nest-auth` subpath is consumed where, how a request and its cookies flow from browser to database, the two auth contexts, the module boundaries on each side, and how errors propagate back to the UI. Expands the diagram in [OVERVIEW §3](./OVERVIEW.md).

---

## Layered overview

```
Browser ──HTTPS──▶ apps/web (Next.js 16) ──JSON, same-origin /api──▶ apps/api (NestJS 11) ──▶ PostgreSQL + Redis
   ▲   HttpOnly cookies:        edge proxy (proxy.ts)              BymaxAuthModule.registerAsync
   │   access_token             route handlers (/api/auth/*)        guards · services · repositories
   └── refresh_token, has_session  <AuthProvider> + hooks            AppAuthHooks → AuditLog
```

The two apps are independently deployable and share no in-process state — everything the browser needs travels in HttpOnly cookies. See [deployment](./DEPLOYMENT.md) for the production topology.

---

## Library subpath map

`@bymax-one/nest-auth` ships five entry points. Each is consumed in a specific place; the host never reshapes library objects (see [Appendix B](./DEVELOPMENT_PLAN.md#appendix-b--library-export--example-file-map)).

| Subpath                       | Used for                                                                                           | Host consumer (primary)                                                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@bymax-one/nest-auth`        | `BymaxAuthModule`, DI tokens, guards, decorators, DTOs, services, `AUTH_ERROR_CODES`, crypto utils | [`apps/api/src/auth/auth.module.ts`](../apps/api/src/auth/auth.module.ts), [`main.ts`](../apps/api/src/main.ts), [`projects.controller.ts`](../apps/api/src/projects/projects.controller.ts) |
| `@bymax-one/nest-auth/shared` | `AUTH_ERROR_CODES`, `AuthClientError`, cookie & route name constants, JWT payload types            | [`apps/web/lib/auth-errors.ts`](../apps/web/lib/auth-errors.ts), [`apps/web/proxy.ts`](../apps/web/proxy.ts)                                                                                 |
| `@bymax-one/nest-auth/client` | `createAuthClient`, `createAuthFetch`, typed request/response models                               | [`apps/web/lib/auth-client.ts`](../apps/web/lib/auth-client.ts)                                                                                                                              |
| `@bymax-one/nest-auth/react`  | `AuthProvider`, `useSession`, `useAuth`, `useAuthStatus`                                           | [`apps/web/app/providers.tsx`](../apps/web/app/providers.tsx), `apps/web/components/**`                                                                                                      |
| `@bymax-one/nest-auth/nextjs` | `createAuthProxy`, the three `route.ts` handlers, JWT decode/verify helpers                        | [`apps/web/proxy.ts`](../apps/web/proxy.ts), [`apps/web/app/api/auth/`](../apps/web/app/api/auth/), [`apps/web/lib/require-auth.ts`](../apps/web/lib/require-auth.ts)                        |

> **Why webpack.** The web app builds with `next dev/build --webpack` because Turbopack cannot resolve the library's subpath `exports` map. See [troubleshooting](./TROUBLESHOOTING.md#web-build-fails-to-resolve-library-subpath-exports).

---

## Request and cookie lifecycle

### Login (cookie mode)

```mermaid
sequenceDiagram
    participant B as Browser
    participant W as apps/web (proxy + route)
    participant A as apps/api (BymaxAuthModule)
    participant DB as PostgreSQL
    participant R as Redis

    B->>W: POST /api/auth/login (email, password, X-Tenant-Id)
    W->>A: forward to INTERNAL_API_URL
    A->>DB: PrismaUserRepository.findByEmail (tenant-scoped)
    A->>R: brute-force check (lf:) + create session (sess:/sd:/rt:)
    alt MFA enabled
        A-->>B: 200 { status: "mfa_required" }
        B->>W: POST /api/auth/mfa/challenge (code)
        W->>A: forward
        A->>R: verify TOTP, finalize session
    end
    A-->>B: Set-Cookie access_token, refresh_token, has_session (HttpOnly)
    B->>W: GET /dashboard
    W->>W: proxy.ts verifies access cookie (HS256, AUTH_JWT_SECRET_FOR_PROXY)
    W-->>B: dashboard; <AuthProvider> hydrates useSession()
```

### Silent refresh

```mermaid
sequenceDiagram
    participant B as Browser
    participant W as apps/web (silent-refresh route)
    participant A as apps/api

    B->>W: GET /api/auth/silent-refresh (access token near expiry)
    W->>A: forward with refresh_token cookie (path /api/auth)
    A->>A: rotate tokens (30s grace window) — old rt: stays valid briefly
    A-->>B: Set-Cookie new access_token + refresh_token
    Note over B,W: createSilentRefreshHandler runs server-side;<br/>the browser never sees the refresh token in JS
```

The edge proxy (`createAuthProxy`) verifies the **access** cookie at the edge to gate routes; the **origin** guard (`JwtAuthGuard`) re-verifies on the API and additionally checks the `rv:{jti}` revocation list in Redis. Edge gating is a fast first filter; the API is the authority.

---

## Platform vs dashboard: two auth contexts

The app runs two completely independent authentication contexts in the same browser. They do not interfere — a user can be a tenant member (cookies) and a platform admin (bearer) at once.

| Aspect        | Tenant dashboard                             | Platform admin                                                                                                                                         |
| ------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Token storage | `HttpOnly` cookies (set by the library)      | `sessionStorage` (bearer tokens)                                                                                                                       |
| Transport     | `Cookie` header (automatic)                  | `Authorization: Bearer <token>`                                                                                                                        |
| Guard         | `JwtAuthGuard` (+ tenant context)            | `JwtPlatformGuard`                                                                                                                                     |
| Login route   | `POST /api/auth/login` (needs `X-Tenant-Id`) | `POST /api/auth/platform/login`                                                                                                                        |
| Edge gating   | `proxy.ts` verifies the access cookie        | `proxy.ts` treats `/platform/*` as public; gating is client-side in [`shell.tsx`](../apps/web/app/platform/shell.tsx) + API-side in `JwtPlatformGuard` |

**Why bearer + `sessionStorage` for platform?** `JwtPlatformGuard` reads the token from the `Authorization` header, and the platform login returns `{ accessToken, refreshToken, admin }` in the JSON body (not `Set-Cookie`). Keeping these in `sessionStorage` avoids cookie collisions with the tenant session and clears them when the tab closes. The Next.js proxy can only inspect cookie JWTs, so it cannot gate bearer routes — the real gate is `JwtPlatformGuard` on the API.

---

## Module boundaries

### `apps/api`

Strict top-down layering, enforced by the "no cross-feature imports" rule:

```
controller  →  service  →  repository  →  Prisma
   │             │            (thin translation only)
   └── guards/decorators from @bymax-one/nest-auth (never re-implemented)
```

- Each feature (`auth`, `account`, `users`, `platform`, `projects`, `tenants`, `invitations`, `notifications`, `health`, `debug`) is self-contained.
- Library wiring is centralised in [`auth.module.ts`](../apps/api/src/auth/auth.module.ts), which registers `BymaxAuthModule` with the four app-owned contracts (`IUserRepository`, `IPlatformUserRepository`, `IEmailProvider`, `IAuthHooks`) plus the Redis client, and re-exports `BymaxAuthModule` so feature modules get the guards/decorators without importing the library directly.
- Shared infrastructure (`prisma`, `redis`, `config`, `logger`) is imported by features; features never import each other.

### `apps/web`

```
app/ route (server component)  →  components/ (client leaf)  →  hooks (useSession/useAuth)  →  authClient  →  same-origin /api
                                          proxy.ts (edge) gates every route before render
```

- Server components render at the route; interactivity lives in client leaves.
- All API access goes through `authClient` ([`lib/auth-client.ts`](../apps/web/lib/auth-client.ts)) — never a hand-rolled `fetch` to the API.
- The three route handlers under [`app/api/auth/`](../apps/web/app/api/auth/) are library-owned (`createSilentRefreshHandler`, `createClientRefreshHandler`, `createLogoutHandler`).

---

## WebSocket authentication

The notifications gateway authenticates the WebSocket **upgrade** request — NestJS guards do not intercept connections, so [`NotificationsGateway.handleConnection`](../apps/api/src/notifications/notifications.gateway.ts) verifies the token manually:

1. Prefer `Authorization: Bearer <token>` from the upgrade headers (non-browser clients).
2. Fall back to the `access_token` HttpOnly cookie, which browsers forward automatically on **same-origin** WS upgrades (the web app proxies `/ws/*` to the gateway).
3. Verify HS256, require `type: "dashboard"`, and check the `rv:{jti}` revocation key in Redis — closing with code `4401` on any failure.

The per-user socket registry is an in-memory `Map` keyed by `userId`; suspending a user calls `disconnectUser(userId)` to force-close their sockets (code `4403`).

---

## Error propagation

Auth failures use a single, deterministic envelope so the frontend never leaks internals (anti-enumeration, FCM #29):

```
library throws AuthException (carries an AUTH_ERROR_CODES code)
        │
        ▼
AuthExceptionFilter (apps/api/src/auth/auth-exception.filter.ts, registered in main.ts)
        │   maps to { code, message, statusCode }
        ▼
authClient receives the envelope → throws AuthClientError (@bymax-one/nest-auth/client)
        │
        ▼
UI maps `code` → user-facing copy via AUTH_ERROR_CODES (apps/web/lib/auth-errors.ts)
```

The raw server message is never rendered; the UI selects copy by code, so e.g. wrong-password and unknown-email both surface as `INVALID_CREDENTIALS`.

---

## Further reading

- [Features](./FEATURES.md) — each capability traced to its files.
- [Database](./DATABASE.md) and [Redis](./REDIS.md) — the two state stores in the diagrams above.
- [Environment](./ENVIRONMENT.md) — the URLs and secrets that wire the two apps together.
- [Deployment](./DEPLOYMENT.md) — how this topology maps to production.
