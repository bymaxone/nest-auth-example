# Phase 15 — Platform Admin Area (Frontend) — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-15--platform-admin-area-frontend) §Phase 15
> **Total tasks:** 4
> **Progress:** 🟢 4 / 4 done (100%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID    | Task                                          | Status | Priority | Size | Depends on        |
| ----- | --------------------------------------------- | ------ | -------- | ---- | ----------------- |
| P15-1 | Platform login page                           | 🟢     | High     | S    | Phase 9, Phase 12 |
| P15-2 | Platform layout shell (visually distinct)     | 🟢     | High     | S    | P15-1             |
| P15-3 | Platform tenants page                         | 🟢     | Medium   | S    | P15-2             |
| P15-4 | Platform users page (tenant picker + suspend) | 🟢     | Medium   | M    | P15-2, P15-3      |

---

## P15-1 — Platform login page

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S
- **Depends on:** Phase 9, Phase 12

### Description

Build `app/platform/login/page.tsx` — a separate login form that posts to `POST /api/auth/platform/login` and stores its tokens in cookies scoped separately from the dashboard cookies (library-configured names). This must not share session state with the dashboard: a dashboard-authenticated user who navigates to `/platform/login` still sees the form. Covers FCM row **#22 (platform admin context — `controllers.platform: true`, `JwtPlatformGuard`)**.

### Acceptance Criteria

- [x] `app/platform/login/page.tsx` renders a login form (`email`, `password`) via `react-hook-form` + `zod`.
- [x] Submit posts JSON to `POST /api/auth/platform/login` via `auth-client`; on success, redirects to `/platform/tenants`.
- [x] Error codes from the library (e.g. `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`) are surfaced via `lib/auth-errors.ts`.
- [x] Platform tokens are bearer-mode (returned in response body); stored in `sessionStorage` via `lib/platform-auth.ts` — no cookie collision with dashboard session possible.
- [x] A dashboard-logged-in user visiting `/platform/login` still sees the form (the two contexts are orthogonal).
- [x] Playwright spec (`e2e/platform-login.spec.ts`) logs in as `platform@example.dev` and asserts redirect to `/platform/tenants`.

### Files to create / modify

- `apps/web/app/platform/login/page.tsx` — new page.
- `apps/web/components/platform/platform-login-form.tsx` — form component.
- `apps/web/lib/auth-client.ts` — add `platformLogin(...)` helper (posts to `/api/auth/platform/login`).

### Agent Execution Prompt

> Role: Senior React / Next.js engineer fluent with `react-hook-form`, `zod`, shadcn/ui, and `@bymax-one/nest-auth/react` (`useAuthStatus`).
>
> Context: FCM row #22 — the library exposes a parallel platform-admin auth context. The API registers `POST /auth/platform/login` when `controllers.platform: true`. Its cookies are named separately so that platform and tenant sessions coexist safely in the same browser.
>
> Objective: Ship the standalone platform login page + form.
>
> Steps:
>
> 1. Create `platform-login-form.tsx` with `react-hook-form` + `zod` (email + password). On submit, call `auth-client.platformLogin({ email, password })` which POSTs to `/api/auth/platform/login` with `credentials: 'include'`.
> 2. On success, `router.replace('/platform/tenants')`.
> 3. On error, surface the error code via `lib/auth-errors.ts`. Add `PLATFORM_LOGIN_FAILED` (or reuse `INVALID_CREDENTIALS`) keys as needed.
> 4. `page.tsx` is a server component that renders the form inside a bare Platform-branded card; do not gate it server-side against a dashboard session — the two contexts must not bleed into each other.
> 5. Playwright spec: visit `/platform/login`, submit seeded platform-admin credentials, assert the URL becomes `/platform/tenants`.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (strict TS, ESM, Tailwind v4 tokens).
> - Use `useAuthStatus` from `@bymax-one/nest-auth/react` if you need to observe state; do not hand-roll cookie reads.
> - Platform cookies are configured by the library — do not hard-code their names in the frontend.
> - No third-party QR/OTP/WS services introduced.
>
> Verification:
>
> - `pnpm --filter web typecheck && pnpm --filter web lint` — expected: green.
> - `pnpm --filter web test:e2e -- platform-login` — Playwright spec logs in as `superadmin@platform.local` and asserts redirect to `/platform/tenants`; expected: green.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P15-1 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P15-2 — Platform layout shell (visually distinct)

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S
- **Depends on:** `P15-1`

### Description

Build `app/platform/layout.tsx` as a distinct shell for the platform-admin area. Header must clearly display **"PLATFORM ADMIN"** with a contrasting background color (e.g., red-tinted header) so an operator can never confuse it with the tenant dashboard. The shell also includes a `Sign out` action wired to `POST /api/auth/logout` that targets the platform cookies. Covers FCM row **#22**.

### Acceptance Criteria

- [x] `app/platform/layout.tsx` renders a persistent top header labelled `PLATFORM ADMIN` in a visibly contrasting red-tinted color.
- [x] Sidebar nav: `Tenants`, `Users`. Items use `lucide-react` icons (`Building2`, `Users`).
- [x] Top-right has an avatar with admin initials and a `Sign out` button that calls `platformLogout()`, clears sessionStorage, and redirects to `/platform/login`.
- [x] Client-side guard in `app/platform/shell.tsx` redirects to `/platform/login` if no bearer token found in sessionStorage (bearer-mode tokens cannot be gated at the proxy level).
- [x] `docs/ARCHITECTURE.md` documents how platform bearer tokens and dashboard cookies coexist without collision.
- [x] Playwright spec (`e2e/platform-shell.spec.ts`) logs in as platform admin and asserts `PLATFORM ADMIN` text is visible.

### Files to create / modify

- `apps/web/app/platform/layout.tsx` — new layout.
- `apps/web/components/platform/platform-topbar.tsx` — distinct header with sign-out.
- `apps/web/components/platform/platform-sidebar.tsx` — `Tenants`, `Users` nav.
- `docs/ARCHITECTURE.md` — short section on platform vs dashboard cookie scoping.

### Agent Execution Prompt

> Role: Senior React / Next.js engineer with an eye for operator UX; fluent with Next.js 16 App Router, Tailwind v4, shadcn/ui, and `@bymax-one/nest-auth/react` (`useSession`).
>
> Context: FCM row #22. The platform shell must be visually impossible to confuse with the tenant dashboard — an operator who mis-navigates should notice immediately. Cookie scoping is handled by the library (two distinct cookie-name prefixes); the frontend only has to render the UI.
>
> Objective: Ship a distinct, clearly-branded platform shell with sign-out wired correctly.
>
> Steps:
>
> 1. `app/platform/layout.tsx` (server component) renders `<PlatformTopbar />` and `<PlatformSidebar />` around `{children}`. Optionally call the library helper to verify the platform session server-side (defense in depth); if absent, redirect to `/platform/login`.
> 2. `platform-topbar.tsx` uses a red-tinted (e.g., `bg-red-950 text-red-50`) header with the label `PLATFORM ADMIN` left-aligned, and an avatar/`Sign out` dropdown on the right that POSTs to `/api/auth/logout`.
> 3. `platform-sidebar.tsx` shows `Tenants` and `Users` links with icons.
> 4. Add a short paragraph in `docs/ARCHITECTURE.md` explaining that platform and tenant cookies are namespaced separately by the library so they can coexist in the same browser.
> 5. Playwright spec: log in via `/platform/login`, navigate to `/platform/tenants`, assert `PLATFORM ADMIN` text is visible.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Use `useSession` from `@bymax-one/nest-auth/react` for the avatar menu (or a dedicated platform hook if the library ships one).
> - Use only Tailwind v4 color tokens + shadcn/ui primitives — no custom CSS files.
> - Do not introduce `localStorage`; any client-side flags stay in React state.
>
> Verification:
>
> - `pnpm --filter web typecheck && pnpm --filter web lint` — expected: green.
> - `pnpm --filter web test:e2e -- platform-shell` — Playwright spec asserts the `PLATFORM ADMIN` header renders after login; expected: green.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P15-2 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P15-3 — Platform tenants page

- **Status:** 🟢 Done
- **Priority:** Medium
- **Size:** S
- **Depends on:** `P15-2`

### Description

Build `app/platform/tenants/page.tsx` — lists every tenant in the system via `GET /api/platform/tenants` (behind `JwtPlatformGuard`). Columns: name, slug, created at, user count. Row click navigates to `/platform/users?tenantId=<id>`. Covers FCM row **#22**.

### Acceptance Criteria

- [x] Page renders a table of tenants fetched via `GET /api/platform/tenants`.
- [x] Columns: `Name`, `Slug`, `Created`, `Actions` (`View users` button).
- [x] Each row navigates to `/platform/users?tenantId=<id>` via row click or `View users` button.
- [x] Empty state shown when no tenants exist.
- [x] Errors surfaced via `sonner` + `lib/auth-errors.ts`.
- [x] Playwright spec (`e2e/platform-tenants.spec.ts`) logs in and asserts the two seeded tenants appear.

### Files to create / modify

- `apps/web/app/platform/tenants/page.tsx` — new page.
- `apps/web/components/platform/tenants-table.tsx` — client table.
- `apps/web/lib/auth-client.ts` — add `listPlatformTenants()` helper.

### Agent Execution Prompt

> Role: Senior React / Next.js engineer fluent with shadcn/ui `Table` and `@bymax-one/nest-auth/react` (`useSession`, `useAuthStatus`).
>
> Context: FCM row #22. The backend endpoint `GET /api/platform/tenants` is registered by the library when `controllers.platform: true` and guarded by `JwtPlatformGuard`. The frontend only needs to call it with `credentials: 'include'` so the platform cookies ride along.
>
> Objective: Ship the tenants list for platform admins.
>
> Steps:
>
> 1. Add `listPlatformTenants()` to `auth-client.ts`.
> 2. Build `tenants-table.tsx` as a client component; render a shadcn `Table` with sortable columns (sorting is UI-only; no API sort).
> 3. Make each row a `<Link href={\`/platform/users?tenantId=${t.id}\`}>`wrapper or trigger a`router.push`.
> 4. Handle empty / loading / error states; route errors through `lib/auth-errors.ts`.
> 5. Playwright spec: log in as platform admin and assert the seeded tenants are listed.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Use `useSession` / `useAuthStatus` from `@bymax-one/nest-auth/react`.
> - Do not introduce `localStorage`; pagination/sorting state lives in URL search params or React state.
> - No third-party data-grid libraries — shadcn `Table` only.
>
> Verification:
>
> - `pnpm --filter web typecheck && pnpm --filter web lint` — expected: green.
> - `pnpm --filter web test:e2e -- platform-tenants` — Playwright spec asserts seeded tenants render; expected: green.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P15-3 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P15-4 — Platform users page (tenant picker + suspend)

- **Status:** 🟢 Done
- **Priority:** Medium
- **Size:** M
- **Depends on:** `P15-2`, `P15-3`

### Description

Build `app/platform/users/page.tsx`. A tenant picker (prefilled from `?tenantId=…`) lists users in that tenant via `GET /api/platform/users?tenantId=…`. Each row exposes `Suspend` / `Unsuspend` via `PATCH /api/platform/users/:id/status`. The suspended user is immediately kicked on their next request (library `UserStatusGuard` behavior, demonstrated by the Phase 10 WebSocket disconnect path). Covers FCM row **#22** (platform control plane over #23 semantics).

### Acceptance Criteria

- [x] Page reads `tenantId` from URL search params; if missing, renders a `<TenantPicker>` (native `<select>` styled with Tailwind — no Radix select installed).
- [x] On tenant selection, URL updates via `router.replace` and `<PlatformUsersTable>` fetches via `GET /api/platform/users?tenantId=…`.
- [x] Table columns: `Name`, `Email`, `Role`, `Status`, `Created`, `Actions`.
- [x] `Suspend` / `Unsuspend` buttons call `platformUpdateUserStatus` (PATCH); optimistic update with rollback on failure.
- [x] Platform admin cannot suspend themselves — own row button disabled with shadcn `Tooltip`: "You cannot suspend yourself."
- [x] Sign-out in the topbar calls `platformLogout(refreshToken)`, clears sessionStorage, redirects to `/platform/login`.
- [x] Playwright spec (`e2e/platform-users-suspend.spec.ts`) picks Acme Corp, suspends `member.acme@example.com`, asserts badge flips to `Suspended`.

### Files to create / modify

- `apps/web/app/platform/users/page.tsx` — new page.
- `apps/web/components/platform/platform-users-table.tsx` — client table.
- `apps/web/components/platform/tenant-picker.tsx` — reuses `listPlatformTenants()`.
- `apps/web/lib/auth-client.ts` — add `listPlatformUsers(tenantId)` and `platformUpdateUserStatus(userId, status)` helpers.

### Agent Execution Prompt

> Role: Senior React / Next.js engineer fluent with Next.js 16 search-param APIs, shadcn/ui, and `@bymax-one/nest-auth/react` (`useSession`).
>
> Context: FCM row #22 — the platform admin context controls tenants and users at the system level. Suspending a user via the platform route hits the library's platform controller and relies on `UserStatusGuard` + `blockedStatuses` (FCM #23) to kick the target on their next request. The Phase 10 gateway additionally disconnects their WebSockets.
>
> Objective: Ship the platform users page with a tenant picker and status toggle.
>
> Steps:
>
> 1. Add `listPlatformUsers(tenantId)` and `platformUpdateUserStatus(userId, status)` helpers to `auth-client.ts`.
> 2. `page.tsx` is a server component that reads `searchParams.tenantId`. If absent, render `<TenantPicker />`. If present, render `<PlatformUsersTable tenantId={...} />`.
> 3. `<TenantPicker />` calls `listPlatformTenants()` and renders a shadcn `Select`; on change, `router.replace(\`/platform/users?tenantId=${id}\`)`.
> 4. `<PlatformUsersTable />` fetches on mount + whenever `tenantId` changes. Each row has `Suspend` / `Unsuspend` via optimistic update with rollback.
> 5. Disable the self-row toggle (compare to `useSession().user.id`) with a tooltip `"You cannot suspend yourself."`.
> 6. Playwright spec: log in as platform admin, pick a seeded tenant, suspend a seeded member, assert the status cell flips within the optimistic window.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Use `useSession` from `@bymax-one/nest-auth/react`.
> - Surface all error copy via `lib/auth-errors.ts`.
> - Cookies are scoped by the library; do not read or write cookies manually from this page.
>
> Verification:
>
> - `pnpm --filter web typecheck && pnpm --filter web lint` — expected: green.
> - `pnpm --filter web test:e2e -- platform-users-suspend` — Playwright spec suspends a seeded member and asserts the row flips to `Suspended`; expected: green.
> - Manual: the suspended user's next request to `/api/*` receives a 401/403 and they are bounced to `/login`.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P15-4 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## Completion log

- P15-1 ✅ 2026-04-25 — Platform login page: bearer-mode login form (react-hook-form + zod), sessionStorage token storage via lib/platform-auth.ts, redirect to /platform/tenants on success
- P15-2 ✅ 2026-04-25 — Platform layout shell: red-tinted PLATFORM ADMIN header, sidebar with Tenants/Users nav, client-side bearer token guard in shell.tsx, docs/ARCHITECTURE.md updated
- P15-3 ✅ 2026-04-25 — Platform tenants page: TenantsTable fetches listPlatformTenants(), row/button navigates to /platform/users?tenantId=<id>
- P15-4 ✅ 2026-04-25 — Platform users page: TenantPicker (native select) + PlatformUsersTable with optimistic Suspend/Unsuspend, self-suspension prevention via Tooltip
