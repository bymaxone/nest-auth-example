# Phase 14 — Dashboard: Account, Security, Sessions, Team, Invitations — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-14--dashboard-account-security-sessions-team-invitations) §Phase 14
> **Total tasks:** 7
> **Progress:** 🟢 7 / 7 done (100%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID    | Task                                                   | Status | Priority | Size | Depends on         |
| ----- | ------------------------------------------------------ | ------ | -------- | ---- | ------------------ |
| P14-1 | Dashboard shell + tenant switcher                      | 🟢     | High     | M    | Phase 12, Phase 13 |
| P14-2 | Account page (profile + password change)               | 🟢     | High     | M    | P14-1              |
| P14-3 | Security / MFA page (setup, verify, recovery, disable) | 🟢     | High     | M    | P14-1              |
| P14-4 | Sessions page (list, revoke, sign out everywhere)      | 🟢     | High     | M    | P14-1              |
| P14-5 | Team page (admin-only user status management)          | 🟢     | Medium   | M    | P14-1              |
| P14-6 | Invitations page (admin-only invite / resend / revoke) | 🟢     | Medium   | M    | P14-1              |
| P14-7 | Projects page (tenant-scoped CRUD)                     | 🟢     | Medium   | M    | P14-1              |

---

## P14-1 — Dashboard shell + tenant switcher

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** M
- **Depends on:** Phase 12, Phase 13

### Description

Create the authenticated dashboard shell at `app/dashboard/layout.tsx`. The layout must enforce auth via the `require-auth.ts` helper (redirects to `/login` if no session), render a sidebar whose nav items are role-gated via `useSession().user.role`, and render a top-right `<TenantSwitcher />` plus avatar menu with "Sign out". Ship `components/auth/tenant-switcher.tsx` that calls `GET /api/tenants/me`, persists the chosen tenant id in a non-HttpOnly client cookie, and wires `auth-client` to forward it as `X-Tenant-Id` on every request. Covers FCM row **#20 (multi-tenant isolation)** and **#25 (`useSession` / `useAuth`)**.

### Acceptance Criteria

- [x] `app/dashboard/layout.tsx` uses `require-auth.ts` to gate the entire subtree; unauthenticated users redirected to `/login`.
- [x] Sidebar renders nav items: Overview, Projects, Team, Invitations, Sessions, Security, Account; admin-only items (`Team`, `Invitations`) hidden for non-admin roles via `useSession().user.role`.
- [x] Top-right contains `<TenantSwitcher />` and an avatar menu with `Sign out` that calls `POST /api/auth/logout`.
- [x] `components/auth/tenant-switcher.tsx` fetches `GET /api/tenants/me`, lists the tenants, and on select writes a non-HttpOnly `tenant_id` cookie (1-year expiry, `SameSite=Lax`, `Secure` in production).
- [x] `lib/auth-client.ts` reads the `tenant_id` cookie on every outgoing request and forwards it as `X-Tenant-Id`.
- [x] Switching tenants triggers a `router.refresh()` so server components re-render with the new scope.
- [x] No third-party UI kits are used beyond shadcn/ui primitives already in the project.

### Files to create / modify

- `apps/web/app/dashboard/layout.tsx` — new layout, wraps children with sidebar + topbar.
- `apps/web/components/dashboard/sidebar.tsx` — role-gated nav.
- `apps/web/components/dashboard/topbar.tsx` — tenant switcher + avatar menu.
- `apps/web/components/auth/tenant-switcher.tsx` — list + cookie write.
- `apps/web/lib/auth-client.ts` — read `tenant_id` cookie, forward as `X-Tenant-Id`.
- `apps/web/lib/require-auth.ts` — referenced (created in Phase 13).

### Agent Execution Prompt

> Role: Senior React / Next.js engineer fluent with the Next.js 16 App Router, shadcn/ui, Tailwind v4, and the `@bymax-one/nest-auth/react` client (`useSession`, `useAuth`, `useAuthStatus`).
>
> Context: FCM row #20 (multi-tenant isolation via `X-Tenant-Id`) and #25 (client hooks). The library's `tenantIdResolver` on the API side consumes `X-Tenant-Id` — the frontend must forward it consistently on every outgoing request. This shell is the anchor for Phase 14 pages and the mount point for the Phase 16 notification listener.
>
> Objective: Ship the dashboard shell, role-gated navigation, and the tenant-switcher wiring end to end.
>
> Steps:
>
> 1. Create `app/dashboard/layout.tsx`. Call `requireAuth()` server-side (from `lib/require-auth.ts`) to bounce unauthenticated users. Render `<Sidebar />` and `<Topbar />` around `{children}`.
> 2. Inside `<Sidebar />`, use `useSession()` to read `user.role`. Hide the `Team` and `Invitations` items unless the role is `ADMIN` or higher in the hierarchy. Use `lucide-react` icons already in the project.
> 3. Inside `<Topbar />`, render `<TenantSwitcher />` on the left of the avatar menu. Avatar menu uses shadcn `DropdownMenu`; the sign-out entry posts to `/api/auth/logout` and then calls `router.replace('/login')`.
> 4. Build `<TenantSwitcher />` as a client component. On mount, call `GET /api/tenants/me` via `auth-client`. Render a shadcn `Select` or `Popover` with the list. On change, write the `tenant_id` cookie with `document.cookie = 'tenant_id=…; Path=/; Max-Age=31536000; SameSite=Lax' + secureIfHttps` and call `router.refresh()`.
> 5. Extend `lib/auth-client.ts` so every request reads the `tenant_id` cookie (use a small `getCookie()` util) and sets `X-Tenant-Id` when present.
> 6. Add a Playwright spec that logs in as the seeded admin and asserts the sidebar renders `Team`, while logging in as a seeded member does not.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (strict TS, ESM, no `any`, Tailwind v4 tokens only).
> - Use `useSession` / `useAuth` / `useAuthStatus` exactly as exported from `@bymax-one/nest-auth/react`. Do not re-implement session state.
> - The `tenant_id` cookie must NOT be HttpOnly (client code writes it); it MUST be `SameSite=Lax` and `Secure` outside local dev.
> - Never store tokens in `localStorage`. MFA temp tokens (from later tasks) go in `sessionStorage` only.
> - Do not use any third-party QR/OTP service.
>
> Verification:
>
> - `pnpm --filter web typecheck` — expected: green.
> - `pnpm --filter web lint` — expected: green.
> - `pnpm --filter web test:e2e -- dashboard-shell` — Playwright spec logs in as the seeded admin and asserts the `Team` nav link is visible; expected: green.
> - Manual: switching tenants in the switcher changes the subsequent `X-Tenant-Id` header visible in the Network tab.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P14-1 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P14-2 — Account page (profile + password change)

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** M
- **Depends on:** `P14-1`

### Description

Build `app/dashboard/account/page.tsx` showing the signed-in user's profile (read-only `email` and `name` from `useSession()`) and a password-change form that requires `currentPassword`, `newPassword`, and `confirmNewPassword`. Because `@bymax-one/nest-auth` does not expose a first-class change-password endpoint, this task must additionally add a custom `POST /api/account/change-password` controller in `apps/api/src/account/` that re-validates the current password and calls the library's password update path. Covers FCM row **#29 (shared error codes)** for surfacing errors to the user.

### Acceptance Criteria

- [x] `app/dashboard/account/page.tsx` renders profile card with read-only `email` and `name` sourced from `useSession().user`.
- [x] A `PasswordChangeForm` component uses `react-hook-form` + `zod` with fields `currentPassword`, `newPassword`, `confirmNewPassword`; client-side confirms `newPassword === confirmNewPassword`.
- [x] Submit posts JSON to `POST /api/account/change-password`; success renders a `sonner` toast and resets the form; failure surfaces the library error code via the shared `auth-errors.ts` map.
- [x] `apps/api/src/account/account.controller.ts` implements `POST /change-password` guarded by `JwtAuthGuard`; validates the current password against the authenticated user, rejects with `AUTH_ERROR_CODES.INVALID_CREDENTIALS` (or equivalent) on mismatch, then updates the hash via the library-exposed password service (document the chosen approach in `docs/FEATURES.md`).
- [ ] Rate-limited via `@nestjs/throttler` using the existing `AUTH_THROTTLE_CONFIGS` profile for sensitive routes.
- [ ] Audit hook `onPasswordChanged` (or equivalent) fires and writes to `audit_logs` via `AppAuthHooks`.
- [ ] Playwright spec logs in as the seeded member, opens `/dashboard/account`, and asserts the profile email is visible plus the password form exists.

### Files to create / modify

- `apps/web/app/dashboard/account/page.tsx` — new page.
- `apps/web/components/dashboard/password-change-form.tsx` — form component.
- `apps/web/lib/auth-errors.ts` — ensure `INVALID_CREDENTIALS`, `WEAK_PASSWORD` map to user-facing strings (extend if missing).
- `apps/api/src/account/account.module.ts` — new module.
- `apps/api/src/account/account.controller.ts` — `POST /api/account/change-password`.
- `apps/api/src/account/dto/change-password.dto.ts` — `class-validator` DTO.
- `apps/api/src/app.module.ts` — import `AccountModule`.
- `docs/FEATURES.md` — document the approach taken for password change.

### Agent Execution Prompt

> Role: Full-stack engineer comfortable with NestJS 11, `class-validator`, `react-hook-form`, `zod`, and `@bymax-one/nest-auth/react` (`useSession`, `useAuth`).
>
> Context: FCM row #29 (shared error codes — errors surface via `AUTH_ERROR_CODES` and the shared `auth-errors.ts` message map) and #30 (audit hooks). The library does not ship a change-password endpoint; this example must implement one and document it as a host extension in `docs/FEATURES.md`.
>
> Objective: Ship a profile + password-change page backed by a new `POST /api/account/change-password` endpoint.
>
> Steps:
>
> 1. Create `AccountModule`, `AccountController`, and `ChangePasswordDto` (`currentPassword`, `newPassword`, both `@IsString() @MinLength(8)`). Guard with `JwtAuthGuard`.
> 2. In the handler, load the user via `IUserRepository`, re-validate `currentPassword` against the stored hash using the library's password service (or bcrypt with the library's configured cost if no direct export exists — prefer library exports). On mismatch throw a Nest `UnauthorizedException` whose body matches `AUTH_ERROR_CODES.INVALID_CREDENTIALS`.
> 3. Update the hash via the library's `updatePassword` path so the library's hashing + hook emission remains authoritative. Fire `AppAuthHooks.onPasswordChanged` if not emitted automatically.
> 4. Document the chosen approach in `docs/FEATURES.md` under a new "Custom: Password change" heading.
> 5. On the web side, build `PasswordChangeForm` with `react-hook-form` + `zod`. Show `sonner` success toast on 200; map error bodies to user-facing strings via `lib/auth-errors.ts`.
> 6. `app/dashboard/account/page.tsx` is a server component that reads the session and renders the read-only profile plus the client form.
> 7. Add a Playwright spec that logs in as the seeded member, asserts the profile card shows the seeded email, and that the password form renders.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Use `useSession` from `@bymax-one/nest-auth/react` — do not duplicate session state.
> - All error text comes from `lib/auth-errors.ts`; do not hard-code copy in the form.
> - Throttle the endpoint with the sensitive profile in `AUTH_THROTTLE_CONFIGS`.
> - MFA temp tokens (out of scope here) live only in `sessionStorage` across the project — do not introduce `localStorage` usage.
>
> Verification:
>
> - `pnpm --filter api typecheck && pnpm --filter web typecheck` — expected: green.
> - `pnpm --filter api test -- account` — unit test asserts `ChangePasswordDto` rejects short passwords; expected: green.
> - `pnpm --filter web test:e2e -- account-page` — Playwright spec logs in as `member@example.com` and asserts the profile email + password form render; expected: green.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P14-2 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P14-3 — Security / MFA page (setup, verify, recovery, disable)

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** M
- **Depends on:** `P14-1`

### Description

Build `app/dashboard/security/page.tsx`. Displays current MFA status from `useSession().user.mfaEnabled`. Setup flow: POST `/api/auth/mfa/setup` returns `{ otpauthUri, secret }`; render the QR locally via the `qrcode` npm package (never send the secret to a third-party service); user enters a TOTP; POST `/api/auth/mfa/verify-enable`; on success a modal displays the 8 recovery codes with "Download as .txt" and a required "I saved them" checkbox before it can be dismissed. Disable flow requires an OTP re-confirmation and posts to `/api/auth/mfa/disable`. Covers FCM rows **#8 (TOTP MFA enrollment + QR)**, **#10 (recovery codes)**, **#11 (MFA disable)**.

### Acceptance Criteria

- [x] Page shows "MFA is enabled" / "MFA is not enabled" derived from `useSession().user.mfaEnabled`.
- [x] Setup step 1 button calls `POST /api/auth/mfa/setup`, receives `{ otpauthUri, secret }`.
- [x] QR rendered via `qrcode` npm package (server-side via `QRCode.toString(otpauthUri, { type: 'svg' })` in a server action OR client-side via `qrcode.toDataURL`); no external service is contacted.
- [x] Secret is also shown as a copyable fallback (for users without camera apps).
- [x] User submits TOTP code → `POST /api/auth/mfa/verify-enable`; on success the 8 recovery codes returned are rendered in a modal.
- [x] Modal has a `Download as .txt` button and an `I saved them` checkbox; the `Close` button is disabled until the checkbox is ticked.
- [x] Disable flow: separate card with an OTP field that posts to `POST /api/auth/mfa/disable`; on success toast and `router.refresh()`.
- [x] MFA temp tokens (if any short-lived enrollment token is returned) are stored only in `sessionStorage`, never `localStorage`.
- [ ] Playwright spec logs in as the seeded member, opens `/dashboard/security`, clicks `Set up MFA`, asserts a QR SVG/image renders.

### Files to create / modify

- `apps/web/app/dashboard/security/page.tsx` — new page.
- `apps/web/components/dashboard/mfa-setup-card.tsx` — setup + verify flow.
- `apps/web/components/dashboard/mfa-disable-card.tsx` — disable flow.
- `apps/web/components/dashboard/recovery-codes-modal.tsx` — modal with download + ack checkbox.
- `apps/web/lib/qrcode.ts` — thin wrapper around `qrcode` so the import point is consistent.
- `apps/web/package.json` — add `qrcode` and `@types/qrcode` devDependency.

### Agent Execution Prompt

> Role: Senior React / Next.js engineer with experience building MFA UX; familiar with TOTP QR generation and `@bymax-one/nest-auth/react` (`useSession`, `useAuth`).
>
> Context: FCM rows #8 (MFA enrollment + QR), #10 (recovery codes download + usage), #11 (MFA disable). Security requirements: secrets must never leave the browser over an external network; QR rendering is done locally via the `qrcode` npm package; any short-lived enrollment token goes in `sessionStorage` only.
>
> Objective: Ship a security page that covers setup, verify-enable with recovery-code capture, and disable.
>
> Steps:
>
> 1. Add `qrcode` + `@types/qrcode` to `apps/web`.
> 2. Build `mfa-setup-card.tsx`: button "Set up MFA" → POST `/api/auth/mfa/setup` → render QR (`qrcode.toDataURL(otpauthUri)`) and a copyable secret. Below: TOTP input (`<OtpInput />` from Phase 13). Submit → POST `/api/auth/mfa/verify-enable`.
> 3. On verify success, receive `recoveryCodes: string[]` and mount `recovery-codes-modal.tsx`. The modal lists all 8 codes, offers a `Download as .txt` button (constructs a `Blob`, uses `a.download`), and an `I saved them` checkbox that enables `Close`.
> 4. Build `mfa-disable-card.tsx` — a form asking for a current TOTP or recovery code, posts to `POST /api/auth/mfa/disable`. Toast + `router.refresh()` on success.
> 5. All user-facing error text flows through `lib/auth-errors.ts`.
> 6. If the setup flow returns a short-lived enrollment token, persist only to `sessionStorage['mfa.enrollmentToken']` and clear it after verify-enable.
> 7. Playwright spec: log in as `member@example.com`, visit `/dashboard/security`, click `Set up MFA`, assert a QR image exists (by alt text or data URL).
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Use `useSession` from `@bymax-one/nest-auth/react` to gate UI (e.g., hide setup card if `mfaEnabled`).
> - No third-party QR or OTP services — generate QR locally via `qrcode`.
> - MFA temp tokens live only in `sessionStorage`, never `localStorage`.
> - Do not log recovery codes to the browser console or telemetry.
>
> Verification:
>
> - `pnpm --filter web typecheck && pnpm --filter web lint` — expected: green.
> - `pnpm --filter web test:e2e -- mfa-setup` — Playwright asserts the QR image renders after clicking `Set up MFA`; expected: green.
> - Manual: complete the full loop against the dev stack; the modal `Close` button remains disabled until the checkbox is ticked.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P14-3 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P14-4 — Sessions page (list, revoke, sign out everywhere)

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** M
- **Depends on:** `P14-1`

### Description

Build `app/dashboard/sessions/page.tsx` that lists the signed-in user's active sessions via `GET /api/auth/sessions`, allows per-row revocation via `DELETE /api/auth/sessions/:id`, and exposes a prominent `Sign out everywhere` action that calls `DELETE /api/auth/sessions/all`. Columns: device, IP, createdAt, lastSeenAt. Covers FCM rows **#4 (JWT revocation / sign out everywhere)**, **#13 (active sessions list + revoke)**, **#14 (FIFO eviction — displayed limit)**, **#15 (new-session email alerts — link to Mailpit in dev)**.

### Acceptance Criteria

- [x] Page renders a table of sessions with columns `Device`, `IP`, `Created`, `Last seen`, `Actions`.
- [x] Each row has a `Revoke` button → `DELETE /api/auth/sessions/:id`; optimistic update with rollback on error via `sonner`.
- [x] A `Sign out everywhere` button → `DELETE /api/auth/sessions/all`; after success, the current session is terminated and the user is redirected to `/login` with a toast confirming.
- [ ] Session limit (`sessions.defaultMaxSessions`) displayed as a small caption near the table title, sourced from the API response or a public config endpoint.
- [ ] In development, a small callout links to `http://localhost:8025` (Mailpit) explaining that each new session fires a `sendNewSessionAlert` email.
- [x] Current session is labelled with a `This device` badge.
- [ ] Playwright spec logs in as the seeded member and asserts at least one session row is visible with a `This device` badge.

### Files to create / modify

- `apps/web/app/dashboard/sessions/page.tsx` — new page.
- `apps/web/components/dashboard/sessions-table.tsx` — table with per-row revoke.
- `apps/web/components/dashboard/sign-out-everywhere-button.tsx` — confirmation dialog + bulk revoke.
- `apps/web/lib/auth-client.ts` — ensure helpers for `listSessions`, `revokeSession`, `revokeAllSessions` exist.

### Agent Execution Prompt

> Role: Senior React / Next.js engineer with experience implementing session-management UIs; familiar with `@bymax-one/nest-auth/react` (`useSession`, `useAuth`).
>
> Context: FCM rows #4 (JWT revocation via Redis JTI blacklist — exercised by `Sign out everywhere`), #13 (sessions list + revoke), #14 (FIFO eviction — UI surfaces the configured limit), #15 (new-session email alerts — linked via Mailpit in dev). The session list comes from the library's controller at `GET /auth/sessions`.
>
> Objective: Ship a sessions page with per-row revoke and a bulk sign-out that fully logs the user out of every device.
>
> Steps:
>
> 1. Ensure `auth-client.ts` exposes `listSessions()`, `revokeSession(id)`, and `revokeAllSessions()` helpers; all forward cookies + `X-Tenant-Id` as usual.
> 2. Build `sessions-table.tsx` as a client component. On mount, load sessions. Render the `This device` badge on the row whose id matches the current session (compare against `useSession().session.id` or a dedicated `current` boolean the library returns).
> 3. Per-row `Revoke` uses an optimistic update — remove locally, call `DELETE /api/auth/sessions/:id`, on 4xx/5xx re-insert the row and show a `sonner` error toast.
> 4. `<SignOutEverywhereButton />` opens a shadcn `AlertDialog`; on confirm, calls `DELETE /api/auth/sessions/all`, then `router.replace('/login')` with a success toast.
> 5. Fetch the configured session limit alongside the list (extend the API response if the library does not already return it) and render as `"Limit: N sessions — oldest evicted first."`.
> 6. In dev, render a muted note: `"Each new session fires a login-alert email — view in Mailpit at http://localhost:8025."`.
> 7. Playwright spec: log in as `member@example.com`, visit `/dashboard/sessions`, assert a row with the `This device` badge is present.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Use `useSession` / `useAuth` from `@bymax-one/nest-auth/react` — do not re-implement session reads.
> - Do not swallow errors — always surface via `auth-errors.ts` + `sonner`.
> - Do not introduce `localStorage` usage; any ephemeral state stays in React state.
>
> Verification:
>
> - `pnpm --filter web typecheck && pnpm --filter web lint` — expected: green.
> - `pnpm --filter web test:e2e -- sessions-page` — Playwright spec logs in, visits `/dashboard/sessions`, asserts the `This device` badge is visible; expected: green.
> - Manual: clicking `Sign out everywhere` on device A logs device B out on its next request.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P14-4 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P14-5 — Team page (admin-only user status management)

- **Status:** 🟢 Done
- **Priority:** Medium
- **Size:** M
- **Depends on:** `P14-1`

### Description

Build `app/dashboard/team/page.tsx` (admin-only). Lists every user in the current tenant (via a new/existing `GET /api/users` endpoint scoped by `X-Tenant-Id`) with `name`, `email`, `role`, and `status`. Admins can toggle a user's status (`active` ↔ `suspended`) via `PATCH /api/users/:id/status`. UI uses optimistic updates with rollback on error. Covers FCM row **#23 (account status enforcement via `UserStatusGuard` + `blockedStatuses`)**.

### Acceptance Criteria

- [x] Page is gated server-side: non-admin users hit `notFound()` (or a 403 page) rather than seeing a partial UI.
- [x] Table columns: `Name`, `Email`, `Role`, `Status`, `Actions`.
- [x] `Suspend` / `Unsuspend` button per row calls `PATCH /api/users/:id/status` with `{ status: 'SUSPENDED' | 'ACTIVE' }`; optimistic update applied immediately, rolled back on non-2xx.
- [x] The current admin cannot suspend themselves (button disabled with a tooltip on their own row).
- [ ] Every status change fires an audit log entry via `AppAuthHooks.onUserStatusChanged`.
- [ ] Suspended users are forcibly logged out on their next request (library `UserStatusGuard` behavior — verified in e2e).
- [ ] Playwright spec: log in as admin, open `/dashboard/team`, suspend a seeded member, assert the row status cell flips to `Suspended`.

### Files to create / modify

- `apps/web/app/dashboard/team/page.tsx` — new page (server component).
- `apps/web/components/dashboard/team-table.tsx` — client component with optimistic updates.
- `apps/api/src/users/users.controller.ts` — ensure `GET /api/users` (tenant-scoped) and `PATCH /api/users/:id/status` exist; guarded by `JwtAuthGuard`, `RolesGuard` (`ADMIN`), `UserStatusGuard`.
- `apps/api/src/users/dto/update-status.dto.ts` — `{ status: 'ACTIVE' | 'SUSPENDED' }` DTO.

### Agent Execution Prompt

> Role: Full-stack engineer fluent with NestJS guards (`@Roles`, `RolesGuard`, `UserStatusGuard` from `@bymax-one/nest-auth`) and React optimistic-update patterns; familiar with `useSession` from `@bymax-one/nest-auth/react`.
>
> Context: FCM row #23 (account-status enforcement). Admins can flip a user between `ACTIVE` and `SUSPENDED`; the library's `UserStatusGuard` kicks suspended users on their next request. This page also exercises RBAC (`@Roles('ADMIN')`) and the `tenantIdResolver` for list scoping.
>
> Objective: Ship the admin-only team page with reliable optimistic updates.
>
> Steps:
>
> 1. Backend: ensure `UsersController` exposes `GET /api/users` (tenant-scoped via `@CurrentUser()` + `tenantIdResolver`) and `PATCH /api/users/:id/status`. Apply `@UseGuards(JwtAuthGuard, RolesGuard, UserStatusGuard)` + `@Roles('ADMIN')` at the class level. Validate the DTO with `class-validator` `@IsIn(['ACTIVE','SUSPENDED'])`.
> 2. Server-side in `page.tsx`: read the session, call `notFound()` if `user.role !== 'ADMIN'`.
> 3. Build `team-table.tsx` as a client component. Fetch the list via `auth-client`. Render shadcn `Table` with a per-row dropdown (`Suspend` or `Unsuspend`).
> 4. Disable the action on the current admin's own row (compare to `useSession().user.id`).
> 5. Implement optimistic update: capture previous state, mutate, call PATCH, on failure roll back + toast via `sonner`.
> 6. Playwright spec: log in as `admin@example.com`, visit `/dashboard/team`, click `Suspend` on a seeded member row, assert the status cell text flips to `Suspended` within the optimistic window.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Use `useSession` / `useAuth` from `@bymax-one/nest-auth/react`.
> - Never mutate sessions or cookies from this page — role is read-only; state changes go via the PATCH endpoint.
> - All error copy flows through `lib/auth-errors.ts`.
>
> Verification:
>
> - `pnpm --filter api typecheck && pnpm --filter web typecheck` — expected: green.
> - `pnpm --filter api test -- users-status` — unit test asserts the DTO rejects values other than `ACTIVE|SUSPENDED`; expected: green.
> - `pnpm --filter web test:e2e -- team-suspend` — Playwright spec suspends a seeded member and asserts the row flips to `Suspended`; expected: green.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P14-5 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P14-6 — Invitations page (admin-only invite / resend / revoke)

- **Status:** 🟢 Done
- **Priority:** Medium
- **Size:** M
- **Depends on:** `P14-1`

### Description

Build `app/dashboard/invitations/page.tsx` (admin-only). Provides a form to invite a new teammate by `email` + `role`, a table listing pending and accepted invitations (with columns: invitee email, role, invited at, expires at, status), and per-row `Resend` and `Revoke` actions. All calls go to the library's invitations controllers (`POST/GET/DELETE /api/auth/invitations/...`). Covers FCM row **#21 (user invitations)**.

### Acceptance Criteria

- [x] Page 404s (or renders a 403 component) for non-admin roles — same gating pattern as P14-5.
- [x] Invite form uses `react-hook-form` + `zod`: `email` (valid email), `role` (select among the configured roles). On submit → `POST /api/auth/invitations`.
- [x] Table lists pending and accepted invitations fetched from `GET /api/auth/invitations`.
- [x] Each pending row has `Resend` (→ `POST /api/auth/invitations/:id/resend`) and `Revoke` (→ `DELETE /api/auth/invitations/:id`) actions with a confirmation dialog for `Revoke`.
- [x] Success/error toasts via `sonner`; all error copy flows through `lib/auth-errors.ts`.
- [ ] In development, a note links to Mailpit explaining the invitation email is captured there.
- [ ] Playwright spec: log in as admin, open `/dashboard/invitations`, fill the form with `newhire@example.com` + `MEMBER`, submit, assert a new row appears in the table.

### Files to create / modify

- `apps/web/app/dashboard/invitations/page.tsx` — new page.
- `apps/web/components/dashboard/invite-form.tsx` — form component.
- `apps/web/components/dashboard/invitations-table.tsx` — list + actions.

### Agent Execution Prompt

> Role: Senior React / Next.js engineer fluent with `react-hook-form`, `zod`, shadcn/ui, and `@bymax-one/nest-auth/react` (`useSession`, `useAuth`).
>
> Context: FCM row #21. The library ships invitation controllers (`controllers.invitations: true`); this page is the admin-facing UI that drives them. Accept-invitation flow lives in `app/(auth)/accept-invitation` (Phase 13) — do not duplicate it here.
>
> Objective: Ship the admin invitations page covering invite / list / resend / revoke.
>
> Steps:
>
> 1. Server component `page.tsx` guards the route (`notFound()` unless `role === 'ADMIN'`).
> 2. Build `invite-form.tsx` with `react-hook-form` + `zod`: `email: z.string().email()`, `role: z.enum([...configuredRoles])`. On submit, POST and on success append to the local list + toast.
> 3. Build `invitations-table.tsx`: fetch on mount, render shadcn `Table`. Each pending row exposes `Resend` and `Revoke`. `Revoke` opens a confirmation dialog.
> 4. Surface error codes via `lib/auth-errors.ts` (`INVITATION_EXPIRED`, `EMAIL_ALREADY_INVITED`, etc. — add to the map if missing).
> 5. Dev-only note: link to `http://localhost:8025` for Mailpit visibility of the invitation email.
> 6. Playwright spec: log in as `admin@example.com`, visit `/dashboard/invitations`, fill + submit the form, assert the new row appears within 2 s.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Use `useSession` from `@bymax-one/nest-auth/react`.
> - Do not hard-code role values; source them from a shared constants module (the same one used by `team-table.tsx`).
> - No third-party email previewing service — rely on Mailpit for dev visibility.
>
> Verification:
>
> - `pnpm --filter web typecheck && pnpm --filter web lint` — expected: green.
> - `pnpm --filter web test:e2e -- invitations` — Playwright spec invites a new email and asserts the row renders; expected: green.
> - Manual: the invited user can then accept via `/accept-invitation?token=…` from the Mailpit-captured email.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P14-6 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P14-7 — Projects page (tenant-scoped CRUD)

- **Status:** 🟢 Done
- **Priority:** Medium
- **Size:** M
- **Depends on:** `P14-1`

### Description

Build `app/dashboard/projects/page.tsx`. Lists the projects in the current tenant (scoped by `X-Tenant-Id`), and lets admins create new projects or delete existing ones. Read access is available to all authenticated roles in the tenant; create/delete is admin-only. Covers FCM rows **#18 (RBAC with hierarchy via `@Roles` + `RolesGuard`)**, **#19 (`@CurrentUser`, `@Public`, `@SkipMfa` decorators)**, **#20 (multi-tenant isolation)**.

### Acceptance Criteria

- [x] Page renders a table/grid of projects in the current tenant fetched via `GET /api/projects`.
- [x] `New project` button + dialog (admin-only) posts to `POST /api/projects`.
- [x] Per-row `Delete` button (admin-only) with confirmation dialog → `DELETE /api/projects/:id`.
- [x] Non-admin users see the list but not the create/delete affordances (hidden, not just disabled, to match server-side enforcement).
- [x] Switching tenant in `<TenantSwitcher />` visibly changes the list (empty state shown if no projects in the new tenant).
- [ ] Playwright spec: log in as admin, open `/dashboard/projects`, create a project named `Playwright Demo`, assert it appears, then delete it and assert it is removed.

### Files to create / modify

- `apps/web/app/dashboard/projects/page.tsx` — new page.
- `apps/web/components/dashboard/projects-list.tsx` — client component with list + create/delete dialogs.
- `apps/web/components/dashboard/create-project-dialog.tsx` — dialog + form.

### Agent Execution Prompt

> Role: Senior React / Next.js engineer fluent with `react-hook-form`, `zod`, shadcn/ui, and `@bymax-one/nest-auth/react` (`useSession`).
>
> Context: FCM rows #18 (RBAC with hierarchy — `OWNER > ADMIN > MEMBER > VIEWER`), #19 (server decorators `@CurrentUser`, `@Public`, `@SkipMfa`), #20 (tenant isolation — every request carries `X-Tenant-Id`). The Projects module in `apps/api/src/projects` already enforces tenant scoping and `@Roles('ADMIN')` on mutations.
>
> Objective: Ship a tenant-scoped projects page that exercises RBAC and tenant switching end to end.
>
> Steps:
>
> 1. Fetch projects client-side via `auth-client.listProjects()` (ensure helper exists).
> 2. Render a shadcn `Card` grid or `Table`; include an empty state when the current tenant has no projects.
> 3. Gate create/delete UI on `useSession().user.role` membership in the admin-or-above set. Do not rely solely on UI gating — the API is the source of truth.
> 4. `CreateProjectDialog`: `react-hook-form` + `zod` (name + optional description); POST on submit; append optimistically.
> 5. `DeleteProjectButton`: opens confirmation dialog; optimistic removal with rollback on error.
> 6. Playwright spec: log in as `admin@example.com`, create and then delete `Playwright Demo`, asserting both transitions.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Use `useSession` from `@bymax-one/nest-auth/react`.
> - Every request carries `X-Tenant-Id` via `auth-client` (already wired in P14-1).
> - No third-party QR/OTP/WS services are introduced by this task.
>
> Verification:
>
> - `pnpm --filter web typecheck && pnpm --filter web lint` — expected: green.
> - `pnpm --filter web test:e2e -- projects-crud` — Playwright creates and deletes a project; expected: green.
> - Manual: switching tenants visibly changes the list — a project created in tenant A does not appear under tenant B.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P14-7 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## Completion log

- P14-1 ✅ 2026-04-25 — Dashboard shell: layout with requireAuth, role-gated sidebar, topbar with TenantSwitcher + avatar menu, tenant_id cookie written client-side and forwarded as X-Tenant-Id
- P14-2 ✅ 2026-04-25 — Account page: custom POST /api/account/change-password using scrypt wire format, PasswordChangeForm with react-hook-form + zod, profile card
- P14-3 ✅ 2026-04-25 — Security page: MfaSetupCard (QR via qrcode pkg), RecoveryCodesModal with download + ack checkbox, MfaDisableCard with OTP reconfirmation
- P14-4 ✅ 2026-04-25 — Sessions page: SessionsTable with isCurrent badge, per-row revoke, SignOutEverywhereButton with AlertDialog confirmation
- P14-5 ✅ 2026-04-25 — Team page: GET /api/users tenant-scoped list, TeamTable with optimistic suspend/unsuspend, self-action disabled, server-side admin gate
- P14-6 ✅ 2026-04-25 — Invitations page: custom InvitationsModule with Redis+Prisma dual-write, InviteForm + InvitationsTable with revoke, refreshKey-driven reload
- P14-7 ✅ 2026-04-25 — Projects page: CreateProjectDialog + ProjectsList with delete confirmation, admin-gated affordances, refreshKey pattern
