# Phase 12 — Frontend Auth Wiring (Client, Provider, Proxy, Refresh, Logout) — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-12--frontend-auth-wiring-client-provider-proxy-refresh-logout) §Phase 12
> **Total tasks:** 6
> **Progress:** 🔴 0 / 6 done (0%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID    | Task                                                                                                       | Status | Priority | Size | Depends on |
| ----- | ---------------------------------------------------------------------------------------------------------- | ------ | -------- | ---- | ---------- |
| P12-1 | `lib/auth-client.ts` — `createAuthClient` singleton + `AuthClientError` mapping                            | 🔴     | High     | S    | Phase 11   |
| P12-2 | `app/providers.tsx` — `<AuthProvider>` + `sonner` toaster, mounted in layout                               | 🔴     | High     | S    | P12-1      |
| P12-3 | `apps/web/proxy.ts` — `createAuthProxy` + `middleware.ts` re-export                                        | 🔴     | High     | M    | P12-1      |
| P12-4 | Route handlers — silent-refresh, client-refresh, logout                                                    | 🔴     | High     | M    | P12-1      |
| P12-5 | `lib/require-auth.ts` — server helper using `verifyJwtToken` + `getUserId` / `getUserRole` / `getTenantId` | 🔴     | High     | S    | P12-3      |
| P12-6 | `components/auth/sign-out-button.tsx`                                                                      | 🔴     | High     | XS   | P12-4      |

---

## P12-1 — `lib/auth-client.ts` — `createAuthClient` singleton + `AuthClientError` mapping

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** S
- **Depends on:** Phase 11

### Description

Ship the single typed HTTP client that every page and hook in `apps/web` will use to talk to the API. Built on `createAuthClient` from `@bymax-one/nest-auth/client` with same-origin base URL `/api` (the Next.js rewrite from P11-2 forwards to the NestJS service) and `credentials: 'include'` so HttpOnly cookies flow. Also ship an `AuthClientError` → toast + redirect mapping helper consumed by every form in Phase 13. Covers FCM row #25 foundation.

### Acceptance Criteria

- [ ] `apps/web/lib/auth-client.ts` imports `createAuthClient` from `@bymax-one/nest-auth/client`.
- [ ] Exports `export const authClient = createAuthClient({ baseUrl: '/api', routePrefix: 'auth', credentials: 'include' })` as a module-level singleton.
- [ ] Exports a helper `mapAuthClientError(error: unknown): { code: AuthErrorCode | 'UNKNOWN'; message: string; redirectTo?: string }` that normalizes `AuthClientError` instances — including pulling the `code` off the error when present.
- [ ] Exports a helper `handleAuthClientError(error, { toast, router? })` that calls `sonner` toast + optional `router.push(redirectTo)`.
- [ ] Re-exports `AuthClientError` for use in `catch` narrowing on pages.
- [ ] No direct `fetch()` call anywhere in `apps/web` targeting auth routes — per `docs/DEVELOPMENT_PLAN.md` §2 ("HTTP client — `@bymax-one/nest-auth/client` only").

### Files to create / modify

- `apps/web/lib/auth-client.ts` — new.

### Agent Execution Prompt

> Role: Senior Next.js / React engineer shipping the reference auth-client wrapper.
> Context: FCM row #25 (`useSession` / `useAuth` / `useAuthStatus`) plus every form page in Phase 13 all flow through this singleton. The Next.js rewrite in `next.config.mjs` (P11-2) makes `/api/*` same-origin, which is why `baseUrl: '/api'` and `credentials: 'include'` work together.
> Objective: Ship `lib/auth-client.ts` with a `createAuthClient` singleton + error-mapping helpers.
> Steps: 1. Import `createAuthClient` and `AuthClientError` from `@bymax-one/nest-auth/client`. 2. Construct the singleton. 3. Author `mapAuthClientError` + `handleAuthClientError` helpers. 4. Export types `AuthErrorCode` from the library's shared error-code module if available; otherwise redeclare. 5. Add a short JSDoc at the top explaining the same-origin rewrite.
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Use the exact factory name `createAuthClient` from the library.
> - Do not reach into `@bymax-one/nest-auth/*` internal paths — only public subpaths.
> - Keep the file server/client-agnostic — it is imported by both RSC and client components.
>   Verification:
> - `pnpm --filter @nest-auth-example/web typecheck` — expected: green.
> - `pnpm --filter @nest-auth-example/web test --run` — expected: any unit test touching the import path passes.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P12-1 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P12-2 — `app/providers.tsx` — `<AuthProvider>` + `sonner` toaster, mounted in layout

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** S
- **Depends on:** `P12-1`

### Description

Wrap the app tree with `<AuthProvider>` from `@bymax-one/nest-auth/react`, feeding it the `authClient` singleton from P12-1. Also mount the `sonner` `<Toaster />` so the `handleAuthClientError` helper has a destination. The provider is what backs `useSession`, `useAuth`, and `useAuthStatus` throughout the dashboard (FCM row #25). Wire it into `app/layout.tsx` replacing the placeholder shell from P11-5.

### Acceptance Criteria

- [ ] `apps/web/app/providers.tsx` is a `'use client'` module exporting `default function Providers({ children }: { children: ReactNode })`.
- [ ] Imports `AuthProvider` from `@bymax-one/nest-auth/react` and `authClient` from `@/lib/auth-client`.
- [ ] Renders `<AuthProvider client={authClient} onSessionExpired={() => router.push('/auth/login?reason=session_expired')}>` wrapping `{children}`.
- [ ] Mounts `<Toaster richColors position="top-right" />` from `sonner` (via the shadcn-generated `@/components/ui/sonner` if present, else directly from `sonner`).
- [ ] `apps/web/app/layout.tsx` (from P11-5) is updated to wrap `{children}` in `<Providers>{children}</Providers>`.
- [ ] No runtime errors or hydration warnings when hitting `/`.

### Files to create / modify

- `apps/web/app/providers.tsx` — new.
- `apps/web/app/layout.tsx` — update to mount `<Providers>`.

### Agent Execution Prompt

> Role: Senior React 19 / Next.js 16 engineer.
> Context: FCM row #25. The `<AuthProvider>` is the single React provider the library ships — the `useSession`, `useAuth`, and `useAuthStatus` hooks all read its context. `onSessionExpired` is the hook the library calls when silent-refresh ultimately fails; the reference impl redirects to `/auth/login`.
> Objective: Ship `app/providers.tsx` and wire it into `app/layout.tsx`.
> Steps: 1. Create `providers.tsx` as a client component. 2. Import `AuthProvider` from `@bymax-one/nest-auth/react` and the `authClient` singleton. 3. Pull `useRouter` from `next/navigation` so `onSessionExpired` can navigate. 4. Mount `<Toaster />` as a sibling of `<AuthProvider>` children. 5. Update `app/layout.tsx` to render `<Providers>{children}</Providers>` inside `<body>`.
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Quote the exact library symbol `AuthProvider` in imports.
> - Do not put any fetch logic in the provider file — all data flow is via `authClient`.
> - Keep server components in `layout.tsx`; the `'use client'` boundary is only inside `providers.tsx`.
>   Verification:
> - `pnpm --filter @nest-auth-example/web dev` — expected: `/` renders, no console errors.
> - Open devtools Components tab — expected: `AuthProvider` visible in the tree.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P12-2 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P12-3 — `apps/web/proxy.ts` — `createAuthProxy` + `middleware.ts` re-export

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P12-1`

### Description

Author the Next.js edge middleware that gates every route in `apps/web` against the cookies set by `@bymax-one/nest-auth`. Uses `createAuthProxy` from `@bymax-one/nest-auth/nextjs` with the full config from `docs/DEVELOPMENT_PLAN.md` §12.3 — public routes, `publicRoutesRedirectIfAuthenticated`, role-gated protected routes, `loginPath`, `getDefaultDashboard`, `apiBase`, `jwtSecret`, and `blockedUserStatuses`. The file lives at `apps/web/proxy.ts` per `docs/OVERVIEW.md` §5; `apps/web/middleware.ts` is a thin re-export so Next.js picks it up.

### Acceptance Criteria

- [ ] `apps/web/proxy.ts` imports `createAuthProxy` from `@bymax-one/nest-auth/nextjs`.
- [ ] Constructs the proxy with:
  - `publicRoutes: ['/', '/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password', '/auth/verify-email', '/auth/accept-invitation', '/platform/login']`.
  - `publicRoutesRedirectIfAuthenticated: ['/auth/login', '/auth/register']`.
  - `protectedRoutes`:
    - `{ pattern: '/dashboard/:path*', allowedRoles: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] }`
    - `{ pattern: '/dashboard/team/:path*', allowedRoles: ['OWNER', 'ADMIN'] }`
    - `{ pattern: '/dashboard/invitations', allowedRoles: ['OWNER', 'ADMIN'] }`
    - `{ pattern: '/platform/:path*', allowedRoles: ['SUPER_ADMIN', 'SUPPORT'] }`
  - `loginPath: '/auth/login'`
  - `getDefaultDashboard: (role) => role.startsWith('PLATFORM') ? '/platform' : '/dashboard'`
  - `apiBase: env.INTERNAL_API_URL`
  - `jwtSecret: env.AUTH_JWT_SECRET_FOR_PROXY`
  - `blockedUserStatuses: ['BANNED', 'INACTIVE', 'SUSPENDED']`
- [ ] Exports both `proxy` (the `AuthProxyInstance`) and a `middleware` function calling it.
- [ ] Exports `config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|public/).*)'] }`.
- [ ] `apps/web/middleware.ts` re-exports `middleware` and `config` from `./proxy`.
- [ ] Navigating to `/dashboard` without cookies redirects to `/auth/login`; navigating with valid cookies renders the route.

### Files to create / modify

- `apps/web/proxy.ts` — new.
- `apps/web/middleware.ts` — new, re-export only.

### Agent Execution Prompt

> Role: Senior Next.js 16 engineer fluent in Edge middleware.
> Context: FCM row #26. The proxy is the library's edge gate — it verifies the `access_token` cookie (HS256) using the mirrored secret `AUTH_JWT_SECRET_FOR_PROXY`, enforces `blockedUserStatuses`, and redirects based on role. `apps/web/proxy.ts` is the canonical filename per `docs/OVERVIEW.md` §5; `middleware.ts` re-exports it so Next.js discovers the handler.
> Objective: Ship `proxy.ts` + `middleware.ts` with the full §12.3 config.
> Steps: 1. Import `createAuthProxy` from `@bymax-one/nest-auth/nextjs` and `env` from `@/lib/env`. 2. Build the config object exactly as listed in Acceptance Criteria. 3. Instantiate the proxy and export `middleware` (wraps `proxy` since the library returns a handler) + `config.matcher`. 4. Create `middleware.ts` re-exporting `{ middleware, config }` from `./proxy`. 5. Verify with a curl smoke test.
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 and §12.3.
> - Quote the exact library symbol `createAuthProxy`.
> - Do not hand-roll JWT verification — the proxy does it via its own helpers.
> - The `matcher` must exclude `_next/static`, `_next/image`, `favicon.ico`, `public/*`.
> - Do not log tokens or cookies in middleware.
>   Verification:
> - `pnpm --filter @nest-auth-example/web build` — expected: success, middleware chunk emitted.
> - `pnpm --filter @nest-auth-example/web dev`, then `curl -i http://localhost:3000/dashboard` — expected: `302` to `/auth/login`.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P12-3 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P12-4 — Route handlers — silent-refresh, client-refresh, logout

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P12-1`

### Description

Mount the three Next.js route handlers the library exposes via `@bymax-one/nest-auth/nextjs`: `createSilentRefreshHandler` (GET), `createClientRefreshHandler` (POST), and `createLogoutHandler` (POST). These back FCM rows #27 (silent + client refresh) and #28 (logout). All three live under `app/api/auth/*` and talk to the API over `env.INTERNAL_API_URL` server-side.

### Acceptance Criteria

- [ ] `apps/web/app/api/auth/silent-refresh/route.ts` exports `export const GET = createSilentRefreshHandler({ apiBase: env.INTERNAL_API_URL, jwtSecret: env.AUTH_JWT_SECRET_FOR_PROXY })`.
- [ ] `apps/web/app/api/auth/client-refresh/route.ts` exports `export const POST = createClientRefreshHandler({ apiBase: env.INTERNAL_API_URL })`.
- [ ] `apps/web/app/api/auth/logout/route.ts` exports `export const POST = createLogoutHandler({ apiBase: env.INTERNAL_API_URL, redirect: { to: '/auth/login' } })`.
- [ ] Each route file declares `export const runtime = 'nodejs'` (or `'edge'` only if the library helpers are Edge-safe — confirm from `/nextjs/index.ts` exports).
- [ ] GET to `/api/auth/silent-refresh` without cookies returns the library's documented 401-with-clear-cookie behaviour (not a 500).
- [ ] POST to `/api/auth/logout` clears cookies and issues the redirect per `LogoutHandlerRedirectConfig`.

### Files to create / modify

- `apps/web/app/api/auth/silent-refresh/route.ts` — new.
- `apps/web/app/api/auth/client-refresh/route.ts` — new.
- `apps/web/app/api/auth/logout/route.ts` — new.

### Agent Execution Prompt

> Role: Senior Next.js 16 engineer wiring App Router route handlers.
> Context: FCM rows #27 (`createSilentRefreshHandler`, `createClientRefreshHandler`) and #28 (`createLogoutHandler`). The library's `/nextjs` subpath ships these as factories — the consumer only chooses config and HTTP verb. Canonical paths are exported as `SILENT_REFRESH_ROUTE`, `CLIENT_REFRESH_ROUTE`, `LOGOUT_ROUTE` for tests/assertions.
> Objective: Mount all three route handlers under `app/api/auth/*`.
> Steps: 1. Create the three files above. 2. In each, import the matching factory from `@bymax-one/nest-auth/nextjs` and call it with `{ apiBase: env.INTERNAL_API_URL, ... }`. 3. For `createLogoutHandler`, pass `redirect: { to: '/auth/login' }`. 4. For `createSilentRefreshHandler`, pass `jwtSecret: env.AUTH_JWT_SECRET_FOR_PROXY` if the config accepts it (library verifies access-token expiry at the edge). 5. Declare `runtime` explicitly. 6. Smoke-test with curl.
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 and §12.4.
> - Quote the exact library symbols `createSilentRefreshHandler`, `createClientRefreshHandler`, `createLogoutHandler`.
> - Do not add custom auth logic — the factories are exhaustive. If a use case isn't covered, file it as a library issue.
> - Do not log bodies, headers, or cookies.
>   Verification:
> - `pnpm --filter @nest-auth-example/web build` — expected: all three routes emitted.
> - `curl -i -X POST http://localhost:3000/api/auth/logout` — expected: `Set-Cookie` clears tokens + `Location: /auth/login`.
> - `curl -i http://localhost:3000/api/auth/silent-refresh` — expected: library-documented 401/no-op response.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P12-4 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P12-5 — `lib/require-auth.ts` — server helper using `verifyJwtToken` + `getUserId` / `getUserRole` / `getTenantId`

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** S
- **Depends on:** `P12-3`

### Description

Ship the server-side `requireAuth()` helper every protected RSC in `apps/web/app/dashboard/**` will call at the top of its render. Reads the `access_token` cookie via `next/headers`, verifies it using `verifyJwtToken` from `@bymax-one/nest-auth/nextjs`, and extracts identity via `getUserId` / `getUserRole` / `getTenantId`. On failure, calls `redirect('/auth/login')`. The proxy already gates routes, but this helper gives RSCs a typed identity handle without a second network hop.

### Acceptance Criteria

- [ ] `apps/web/lib/require-auth.ts` exports `async function requireAuth(): Promise<{ userId: string; role: string; tenantId: string | null; token: string }>`.
- [ ] Uses `cookies()` from `next/headers` to read the `access_token` cookie (name per library default; honour env override if set).
- [ ] Calls `verifyJwtToken(token, env.AUTH_JWT_SECRET_FOR_PROXY)`; on throw, calls `redirect('/auth/login')`.
- [ ] Extracts identity via `getUserId(decoded)`, `getUserRole(decoded)`, `getTenantId(decoded)`.
- [ ] Also exports `requireRole(allowed: string[])` which calls `requireAuth()` and `redirect('/auth/login')` if the role is not in `allowed`.
- [ ] Contains no `console.log` of tokens, cookies, or PII.

### Files to create / modify

- `apps/web/lib/require-auth.ts` — new.

### Agent Execution Prompt

> Role: Senior Next.js 16 / React 19 engineer.
> Context: The proxy (P12-3) already gates navigation, but protected RSCs still need a typed identity handle at render time. The library's `/nextjs` subpath exports `verifyJwtToken`, `getUserId`, `getUserRole`, `getTenantId` exactly for this purpose — Edge-safe helpers on top of Web Crypto.
> Objective: Ship `lib/require-auth.ts` with `requireAuth()` and `requireRole()`.
> Steps: 1. Import `verifyJwtToken`, `getUserId`, `getUserRole`, `getTenantId` from `@bymax-one/nest-auth/nextjs` and `redirect` from `next/navigation`. 2. Read the access-token cookie via `cookies()`. 3. Verify and extract. 4. Author `requireRole(allowed)` that delegates to `requireAuth()` and checks membership.
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Quote the exact library symbols `verifyJwtToken`, `getUserId`, `getUserRole`, `getTenantId`.
> - Do not make any network calls — everything is local JWT verification.
> - The helper is server-only; do not add `'use client'`.
>   Verification:
> - `pnpm --filter @nest-auth-example/web typecheck` — expected: green.
> - Create a placeholder `app/dashboard/page.tsx` that calls `await requireAuth()` and renders `user.userId`; hit it without cookies → redirects to `/auth/login`; with valid cookies → renders the id.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P12-5 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P12-6 — `components/auth/sign-out-button.tsx`

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** XS
- **Depends on:** `P12-4`

### Description

Client-side button that POSTs to `/api/auth/logout` (the `createLogoutHandler` endpoint from P12-4), then calls `router.refresh()` so the server tree re-renders post-logout. Used in the dashboard header dropdown in Phase 14; shipping it here makes Phase 12's definition of done end-to-end testable.

### Acceptance Criteria

- [ ] `apps/web/components/auth/sign-out-button.tsx` is a `'use client'` component exporting `default function SignOutButton()`.
- [ ] Uses a shadcn `<Button variant="ghost" size="sm">` labelled "Sign out" with a `LogOut` icon from `lucide-react`.
- [ ] On click: `await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })`; then `router.refresh()` via `useRouter` from `next/navigation`.
- [ ] On error: surfaces `sonner` toast with message "Sign out failed — please try again".
- [ ] Disabled state during the in-flight request.
- [ ] Smoke test: mounting it in a test page and clicking leads to `/auth/login` (via the logout handler's redirect).

### Files to create / modify

- `apps/web/components/auth/sign-out-button.tsx` — new.

### Agent Execution Prompt

> Role: Senior React 19 engineer.
> Context: FCM row #28. The `createLogoutHandler` route (P12-4) owns cookie clearing and the redirect to `/auth/login`. The client only POSTs and refreshes.
> Objective: Ship `components/auth/sign-out-button.tsx`.
> Steps: 1. Author the `'use client'` component with a shadcn `<Button>` and `lucide-react` `LogOut` icon. 2. On click, `fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })`. 3. On 2xx/3xx, `router.refresh()`. 4. On error, `toast.error(...)`. 5. Manage a `isPending` state to disable during the request.
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Do not import `authClient` just for logout — the handler owns the API call.
> - Do not call `router.push('/auth/login')` explicitly — let the handler's redirect win.
>   Verification:
> - `pnpm --filter @nest-auth-example/web typecheck` — expected: green.
> - Mount the button on a temp page, click — expected: lands on `/auth/login` with cleared cookies (verify via devtools Application → Cookies).

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P12-6 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## Completion log
