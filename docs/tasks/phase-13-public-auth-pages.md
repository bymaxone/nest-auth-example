# Phase 13 — Public Auth Pages (`app/(auth)`) — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-13--public-auth-pages-appauth) §Phase 13
> **Total tasks:** 8
> **Progress:** 🔴 0 / 8 done (0%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID    | Task                                                                                | Status | Priority | Size | Depends on   |
| ----- | ----------------------------------------------------------------------------------- | ------ | -------- | ---- | ------------ |
| P13-1 | `app/(auth)/layout.tsx` + shared primitives + zod schemas + `auth-errors.ts`        | 🔴     | High     | M    | Phase 12     |
| P13-2 | `login/page.tsx` — email + password + Google + MFA challenge hand-off               | 🔴     | High     | M    | P13-1        |
| P13-3 | `register/page.tsx` — email + name + password + tenant + "verification sent" screen | 🔴     | High     | M    | P13-1        |
| P13-4 | `verify-email/page.tsx` — OTP input + resend cooldown                               | 🔴     | High     | S    | P13-1        |
| P13-5 | `forgot-password/page.tsx` — email input, anti-enumeration success                  | 🔴     | High     | S    | P13-1        |
| P13-6 | `reset-password/page.tsx` — token + OTP modes via `?mode=`                          | 🔴     | High     | M    | P13-1        |
| P13-7 | `mfa-challenge/page.tsx` — TOTP + recovery-code toggle                              | 🔴     | High     | S    | P13-1, P13-2 |
| P13-8 | `accept-invitation/page.tsx` — invite summary + name + password                     | 🔴     | High     | M    | P13-1        |

---

## P13-1 — `app/(auth)/layout.tsx` + shared primitives + zod schemas + `auth-errors.ts`

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** Phase 12

### Description

Lay the foundation every other Phase 13 page will consume: the `(auth)` route-group layout (centered card + brand), the shared OTP and password-input components, a single zod-schema module covering every form shape, and `lib/auth-errors.ts` — a map that translates **every** key of `AUTH_ERROR_CODES` (FCM row #29) into a user-facing message. The anti-enumeration story relies on this map being exhaustive.

### Acceptance Criteria

- [ ] `apps/web/app/(auth)/layout.tsx` renders a centered `<Card>` layout with brand ("nest-auth-example") at the top, children in the card body. Server component; no client code.
- [ ] `apps/web/components/auth/otp-input.tsx` exports `<OtpInput length={6} value onChange />` — six single-character boxes, auto-advance, paste-friendly. Built with `@/components/ui/input`.
- [ ] `apps/web/components/auth/password-input.tsx` exports `<PasswordInput />` — show/hide toggle + simple strength hint (UX only; library owns validation).
- [ ] `apps/web/lib/schemas/auth.ts` exports zod schemas: `loginSchema`, `registerSchema`, `verifyEmailSchema`, `forgotPasswordSchema`, `resetPasswordTokenSchema`, `resetPasswordOtpSchema`, `mfaChallengeSchema`, `acceptInvitationSchema`.
- [ ] `apps/web/lib/auth-errors.ts` imports `AUTH_ERROR_CODES` from `@bymax-one/nest-auth` (shared subpath) and exports `translateAuthError(code: keyof typeof AUTH_ERROR_CODES): string` — covers **every** key, with a TODO-eliminating typecheck (e.g., `satisfies Record<keyof typeof AUTH_ERROR_CODES, string>`).
- [ ] `pnpm --filter @nest-auth-example/web typecheck` passes.

### Files to create / modify

- `apps/web/app/(auth)/layout.tsx` — new.
- `apps/web/components/auth/otp-input.tsx` — new.
- `apps/web/components/auth/password-input.tsx` — new.
- `apps/web/lib/schemas/auth.ts` — new.
- `apps/web/lib/auth-errors.ts` — new.

### Agent Execution Prompt

> Role: Senior Next.js 16 / React 19 engineer shipping reusable auth primitives.
> Context: FCM row #29 (`AUTH_ERROR_CODES`). Every page in Phase 13 depends on these primitives; getting them right once saves every downstream task. The `satisfies Record<keyof typeof AUTH_ERROR_CODES, string>` trick turns new library error codes into a compile-time error in this repo until they are handled — the safety net `docs/DEVELOPMENT_PLAN.md` §13 relies on.
> Objective: Ship the `(auth)` layout, two shared components, the schemas module, and the error-code translator.
> Steps: 1. Author `(auth)/layout.tsx` as a server component centering a shadcn `<Card>` with brand. 2. Author `<OtpInput />` with 6 single-character inputs, keydown auto-advance, paste handler splitting the clipboard across boxes. 3. Author `<PasswordInput />` wrapping `@/components/ui/input` with an `Eye`/`EyeOff` icon toggle (`lucide-react`). 4. Author `lib/schemas/auth.ts` — every schema uses `react-hook-form`-compatible zod (`z.object({ ... })`). 5. Author `lib/auth-errors.ts` importing `AUTH_ERROR_CODES` and exporting `translateAuthError`. Use `satisfies` to enforce exhaustiveness.
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 and §13.
> - Form library: `react-hook-form` + `zod`. Toasts: `sonner`. UI primitives: `@/components/ui/*`.
> - Quote the exact shared library symbol `AUTH_ERROR_CODES`.
> - `<OtpInput />` must be accessible: `inputMode="numeric"`, `autoComplete="one-time-code"` on the first box.
> - Never import anything under `@bymax-one/nest-auth/dist/*` — only public subpaths.
>   Verification:
> - `pnpm --filter @nest-auth-example/web typecheck` — expected: green; adding a fake new key to `AUTH_ERROR_CODES` locally must break `lib/auth-errors.ts` (proves the `satisfies` trick works).
> - `pnpm --filter @nest-auth-example/web test --run` — expected: any `<OtpInput />` unit test passes.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P13-1 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P13-2 — `login/page.tsx` — email + password + Google + MFA challenge hand-off

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P13-1`

### Description

The canonical login form — FCM rows **#2 (cookie-mode login)** and **#12 (OAuth Google)**. Email + password fields (zod-validated), a "Continue with Google" button rendered only when `env.NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED` is true, and a "Forgot password?" link to `/auth/forgot-password`. When the API responds with an MFA challenge, the page stashes `mfaTempToken` in `sessionStorage` (never a cookie) and navigates to `/auth/mfa-challenge`.

### Acceptance Criteria

- [ ] `apps/web/app/(auth)/login/page.tsx` is a client component using `react-hook-form` with `zodResolver(loginSchema)`.
- [ ] Calls `authClient.login({ email, password })` from `@/lib/auth-client`.
- [ ] On 200 success: `router.replace('/dashboard')` (proxy handles role-based routing from there).
- [ ] On MFA challenge response: writes `mfaTempToken` to `sessionStorage`, `router.push('/auth/mfa-challenge')`.
- [ ] On error: calls `handleAuthClientError`, which pipes `translateAuthError(code)` into `sonner`.
- [ ] Shows "Continue with Google" button (`<Button variant="outline">`) only when `env.NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED === true`; clicking navigates to `/api/auth/oauth/google/start` (library route).
- [ ] "Forgot password?" link under the submit button.
- [ ] `useAuthStatus()` returns `'authenticated'` → server-side redirect via the proxy's `publicRoutesRedirectIfAuthenticated` — verify by logging in and hitting `/auth/login` again.

### Files to create / modify

- `apps/web/app/(auth)/login/page.tsx` — new.

### Agent Execution Prompt

> Role: Senior React 19 engineer shipping FCM rows #2 + #12.
> Context: FCM #2 (cookie-mode login), #12 (OAuth Google button), #9 (MFA hand-off). The `authClient.login` call from P12-1 returns either a success shape or an MFA-challenge shape; switch on the response. `mfaTempToken` must live in `sessionStorage`, per `docs/DEVELOPMENT_PLAN.md` §13.
> Objective: Ship `app/(auth)/login/page.tsx`.
> Steps: 1. Build the `react-hook-form` form with `zodResolver(loginSchema)`. 2. Compose shadcn `Form`, `Input`, `Button`. 3. On submit, call `authClient.login` and branch on the response shape. 4. Conditionally render the Google button based on `env.NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED`. 5. Link "Forgot password?" to `/auth/forgot-password`.
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 and §13.
> - Form: `react-hook-form` + `zod`. Toasts: `sonner`. UI: `@/components/ui/*`.
> - Quote `createAuthClient` (indirectly via `authClient`) and `useAuthStatus` from `@bymax-one/nest-auth/react`.
> - Never write the MFA temp token to a cookie.
> - Do not call `fetch()` directly for the OAuth start URL — use an `<a>` tag (full navigation is required so the browser follows the library's 302).
>   Verification:
> - `pnpm --filter @nest-auth-example/web build` — expected: success.
> - Manual: valid credentials → `/dashboard`; invalid → toast with translated error; credentials on an MFA-enabled account → `/auth/mfa-challenge` with `sessionStorage.mfaTempToken` set.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P13-2 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P13-3 — `register/page.tsx` — email + name + password + tenant + "verification sent" screen

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P13-1`

### Description

FCM row **#1 (email + password registration)**. Form collects email, name, password (using `<PasswordInput />` from P13-1), and a tenant dropdown fed by a lightweight public `/api/tenants/public` query (or hardcoded seed tenants if the endpoint isn't ready yet). On success, swap the form for a "Check your email" confirmation screen with a resend affordance.

### Acceptance Criteria

- [ ] `apps/web/app/(auth)/register/page.tsx` is a client component using `react-hook-form` with `zodResolver(registerSchema)`.
- [ ] Fields: email (`type="email"`), name, password (`<PasswordInput />`), tenant (`<Select>` from shadcn).
- [ ] Calls `authClient.register({ email, name, password, tenantId })`.
- [ ] Conditional render: on success, switches to a "Check your email — we sent a verification link/OTP to {email}" screen with a `Resend` button that calls `authClient.resendVerification`.
- [ ] Google button ("Continue with Google") mirrors the login page's conditional render.
- [ ] Error handling via `translateAuthError` + `sonner` — covers `EMAIL_ALREADY_EXISTS`, `WEAK_PASSWORD`, etc.
- [ ] "Already have an account? Sign in" link to `/auth/login`.

### Files to create / modify

- `apps/web/app/(auth)/register/page.tsx` — new.

### Agent Execution Prompt

> Role: Senior React 19 engineer shipping FCM row #1.
> Context: FCM #1. `emailVerification: required` in the API means registration returns a success shape without a session — users are routed to the verification step. The tenant dropdown is this example's simulation of multi-tenant signup; in a real app it might be a hidden field or a subdomain lookup.
> Objective: Ship `app/(auth)/register/page.tsx`.
> Steps: 1. Build the form with `registerSchema`. 2. Call `authClient.register` and switch to the confirmation screen on success. 3. Implement `Resend` via `authClient.resendVerification` with a 60s cooldown (reuse the cooldown helper from P13-4 if already present; otherwise author it inline and migrate later). 4. Use `sonner` for errors.
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 and §13.
> - Form: `react-hook-form` + `zod`. Toasts: `sonner`. UI: `@/components/ui/*`.
> - Do not re-implement password strength validation — defer to the library's response.
> - If the `/api/tenants/public` endpoint is not yet available, stub with a small static list gated by a `// TODO(P14): source from API` comment.
>   Verification:
> - `pnpm --filter @nest-auth-example/web build` — expected: success.
> - Manual: register a new email → confirmation screen appears; resend button becomes enabled after 60s; Mailpit UI (http://localhost:8025) shows the verification email.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P13-3 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P13-4 — `verify-email/page.tsx` — OTP input + resend cooldown

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** S
- **Depends on:** `P13-1`

### Description

FCM row **#5 (email verification OTP)**. Reads `?email=&tenantId=` from the URL, renders the shared `<OtpInput length={6} />`, and calls `authClient.verifyEmail` with the six-digit code. Resend button is rate-limited on the client with a 60-second cooldown (persisted across mount via `sessionStorage`).

### Acceptance Criteria

- [ ] `apps/web/app/(auth)/verify-email/page.tsx` is a client component.
- [ ] Reads `?email=` and `?tenantId=` using `useSearchParams()`.
- [ ] Renders `<OtpInput length={6} />` inside a `react-hook-form` form using `verifyEmailSchema`.
- [ ] On submit, calls `authClient.verifyEmail({ email, tenantId, code })`.
- [ ] On 200 success: `router.replace('/auth/login?verified=1')`.
- [ ] Resend button calls `authClient.resendVerification`; starts a 60-second countdown immediately after click, persisted in `sessionStorage` under key `verifyEmail:cooldown:{email}`.
- [ ] Error handling via `translateAuthError` + `sonner` — covers `INVALID_OTP`, `OTP_EXPIRED`, `RATE_LIMITED`.
- [ ] Missing `email` / `tenantId` query params: show "Please re-open the link from your email" inline error instead of crashing.

### Files to create / modify

- `apps/web/app/(auth)/verify-email/page.tsx` — new.

### Agent Execution Prompt

> Role: Senior React 19 engineer shipping FCM row #5.
> Context: FCM #5. The library's verification uses OTP over email (no magic-link in this repo per `docs/OVERVIEW.md` §6). The page is deep-linked from the verification email — `?email=&tenantId=` is provided in the link template the API renders.
> Objective: Ship `app/(auth)/verify-email/page.tsx`.
> Steps: 1. Read query params via `useSearchParams()`. 2. Render `<OtpInput />` inside a `react-hook-form` form. 3. Call `authClient.verifyEmail` on submit. 4. Author a `useCooldown(key, seconds)` hook persisting to `sessionStorage`; use it to gate the Resend button. 5. Wire errors through `translateAuthError`.
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 and §13.
> - Form: `react-hook-form` + `zod`. Toasts: `sonner`. UI: `@/components/ui/*`.
> - Do not store the OTP in `sessionStorage` — only the cooldown timestamp.
>   Verification:
> - `pnpm --filter @nest-auth-example/web build` — expected: success.
> - Manual: register → copy OTP from Mailpit → paste into the six boxes → submit → redirected to login; click Resend twice quickly — second click is disabled during the cooldown.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P13-4 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P13-5 — `forgot-password/page.tsx` — email input, anti-enumeration success

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** S
- **Depends on:** `P13-1`

### Description

FCM rows **#6/#7 (password reset — token + OTP modes)**, initial step. Single email input; calls `authClient.forgotPassword({ email })`. To avoid account-enumeration, the UI always shows "If an account exists for that email, we sent reset instructions." — regardless of whether the API reports the email as known or unknown.

### Acceptance Criteria

- [ ] `apps/web/app/(auth)/forgot-password/page.tsx` is a client component.
- [ ] Form uses `forgotPasswordSchema` (email only).
- [ ] Calls `authClient.forgotPassword({ email })`.
- [ ] On any response (200 or 404): shows the same "If an account exists for that email, we sent reset instructions." message. Do not distinguish cases in the UI.
- [ ] Any non-2xx error that isn't "account not found" (e.g., network, rate limit) is surfaced as a toast via `translateAuthError`.
- [ ] Link back to `/auth/login`.
- [ ] Success state replaces the form with the confirmation message; no automatic redirect.

### Files to create / modify

- `apps/web/app/(auth)/forgot-password/page.tsx` — new.

### Agent Execution Prompt

> Role: Senior React 19 engineer shipping FCM rows #6/#7 (entry step).
> Context: FCM #6 (token mode), #7 (OTP mode). Anti-enumeration is the library contract — the API returns 200 for both known and unknown emails, so the page just needs to always show the generic success message. Only surface errors for transport-level failures.
> Objective: Ship `app/(auth)/forgot-password/page.tsx`.
> Steps: 1. Build the form with `forgotPasswordSchema`. 2. Call `authClient.forgotPassword`. 3. On any resolved response, render the confirmation message. 4. On thrown network/rate-limit errors, toast via `translateAuthError`.
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 and §13.
> - Form: `react-hook-form` + `zod`. Toasts: `sonner`. UI: `@/components/ui/*`.
> - Never render "no account with that email" — anti-enumeration is non-negotiable.
> - Handle both response modes in the same submit handler.
>   Verification:
> - `pnpm --filter @nest-auth-example/web build` — expected: success.
> - Manual: submit with a known email → generic confirmation; submit with an unknown email → identical confirmation; Mailpit shows the reset email only for the known case.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P13-5 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P13-6 — `reset-password/page.tsx` — token + OTP modes via `?mode=`

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P13-1`

### Description

FCM rows **#6/#7 (password reset completion)**. Single page covering both modes via the query string: `?mode=token&token=...` renders a password-only form; `?mode=otp&email=...` renders an OTP + password form. Both call `authClient.resetPassword` with the right payload shape. Successful reset redirects to `/auth/login?reset=1`.

### Acceptance Criteria

- [ ] `apps/web/app/(auth)/reset-password/page.tsx` is a client component that reads `?mode=`, `?token=`, `?email=` via `useSearchParams()`.
- [ ] When `mode === 'token'`: uses `resetPasswordTokenSchema` (password, confirmPassword) and submits with the `token` from the URL.
- [ ] When `mode === 'otp'`: uses `resetPasswordOtpSchema` (code, password, confirmPassword); renders `<OtpInput length={6} />` + `<PasswordInput />`.
- [ ] Unknown or missing `mode`: inline message "This link looks incomplete. Please request a new password reset." with a link back to `/auth/forgot-password`.
- [ ] Submit calls `authClient.resetPassword(...)` with the correct payload shape for each mode.
- [ ] On success: `router.replace('/auth/login?reset=1')`.
- [ ] Error handling via `translateAuthError` + `sonner` — includes `INVALID_TOKEN`, `TOKEN_EXPIRED`, `INVALID_OTP`, `WEAK_PASSWORD`.
- [ ] Client-side check: `password === confirmPassword` enforced by the zod schema.

### Files to create / modify

- `apps/web/app/(auth)/reset-password/page.tsx` — new.

### Agent Execution Prompt

> Role: Senior React 19 engineer shipping FCM rows #6/#7 (completion step).
> Context: FCM #6 (token mode), #7 (OTP mode). The API instance powering this demo is configured for one mode at a time (`passwordReset.method: 'token' | 'otp'`), but this page is mode-agnostic by reading `?mode=` so a single codebase can demonstrate both across deploy targets.
> Objective: Ship `app/(auth)/reset-password/page.tsx` supporting both modes.
> Steps: 1. Read `?mode=`, `?token=`, `?email=`. 2. Branch form shape based on `mode`. 3. For both, call `authClient.resetPassword` with the right payload. 4. Redirect to `/auth/login?reset=1` on success. 5. Handle unknown `mode` gracefully.
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 and §13.
> - Form: `react-hook-form` + `zod`. Toasts: `sonner`. UI: `@/components/ui/*`.
> - Use the shared `<OtpInput />` and `<PasswordInput />` from P13-1.
> - Never log the token or OTP.
>   Verification:
> - `pnpm --filter @nest-auth-example/web build` — expected: success.
> - Manual (token mode): request reset → open email link → set a new password → login with it. Manual (OTP mode): request reset → copy OTP from Mailpit → paste → set new password.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P13-6 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P13-7 — `mfa-challenge/page.tsx` — TOTP + recovery-code toggle

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** S
- **Depends on:** `P13-1`, `P13-2`

### Description

FCM rows **#9 (TOTP challenge)** and **#10 (recovery codes)**. The login page (P13-2) redirects here with `mfaTempToken` in `sessionStorage`. The page shows a TOTP input (six boxes); a "Use a recovery code instead" toggle swaps the input for a recovery-code field. Submitting calls `authClient.mfaChallenge({ tempToken, code, type })`. On success, the library sets the session cookies and the page routes to `/dashboard`.

### Acceptance Criteria

- [ ] `apps/web/app/(auth)/mfa-challenge/page.tsx` is a client component.
- [ ] Reads `mfaTempToken` from `sessionStorage` on mount; if missing, redirects to `/auth/login` with a toast.
- [ ] Default mode: TOTP — renders `<OtpInput length={6} />` with `inputMode="numeric"`.
- [ ] "Use a recovery code instead" link toggles to recovery-code mode — renders a plain text input with the expected length.
- [ ] Submit calls `authClient.mfaChallenge({ tempToken, code, type: 'totp' | 'recovery' })`.
- [ ] On success: clear `sessionStorage.mfaTempToken` and `router.replace('/dashboard')`.
- [ ] Error handling via `translateAuthError` + `sonner` — covers `INVALID_MFA_CODE`, `MFA_LOCKED`, `MFA_TOKEN_EXPIRED`.
- [ ] Pressing the browser back button does not leak the temp token to `/auth/login`.

### Files to create / modify

- `apps/web/app/(auth)/mfa-challenge/page.tsx` — new.

### Agent Execution Prompt

> Role: Senior React 19 engineer shipping FCM rows #9 + #10.
> Context: FCM #9 (TOTP challenge), #10 (recovery codes). The `mfaTempToken` is a short-lived handle issued by the login endpoint when MFA is required; it must never touch a cookie — only `sessionStorage` — per `docs/DEVELOPMENT_PLAN.md` §13.
> Objective: Ship `app/(auth)/mfa-challenge/page.tsx` with TOTP + recovery-code modes.
> Steps: 1. On mount, read `sessionStorage.mfaTempToken`; redirect if missing. 2. Render TOTP `<OtpInput />` by default. 3. Add a toggle that swaps to a recovery-code text input. 4. On submit, call `authClient.mfaChallenge` with the right `type`. 5. On success, clear sessionStorage and navigate to `/dashboard`. 6. Defensive: if the user types a recovery code into the OTP boxes, don't submit without toggling mode — let the library return `INVALID_MFA_CODE`.
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 and §13.
> - Form: `react-hook-form` + `zod` (`mfaChallengeSchema` with discriminated union on `type`). Toasts: `sonner`. UI: `@/components/ui/*`.
> - Never write the temp token to a cookie.
> - Clear `sessionStorage.mfaTempToken` on success AND on the mount-time redirect path.
>   Verification:
> - `pnpm --filter @nest-auth-example/web build` — expected: success.
> - Manual: enroll MFA on a test user → log in → land on `/auth/mfa-challenge` → submit a correct TOTP → `/dashboard`. Repeat with a recovery code.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P13-7 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P13-8 — `accept-invitation/page.tsx` — invite summary + name + password

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P13-1`

### Description

FCM row **#21 (invitations)**. Reads `?token=...` from the URL, fetches the invite summary via `authClient.getInvitation(token)` (or the library's equivalent), displays inviter + tenant + role, and collects `name` + `password` to complete signup. On submit, calls `authClient.acceptInvitation({ token, name, password })`. Successful acceptance redirects to `/dashboard` (the library issues session cookies on acceptance).

### Acceptance Criteria

- [ ] `apps/web/app/(auth)/accept-invitation/page.tsx` is a client component.
- [ ] Reads `?token=` via `useSearchParams()`.
- [ ] On mount, calls `authClient.getInvitation(token)` — renders a `Loading…` skeleton while resolving.
- [ ] On resolved invite: renders a summary block ("{inviter} invited you to join {tenant} as {role}") + a form with `name`, `<PasswordInput />` using `acceptInvitationSchema`.
- [ ] Submit calls `authClient.acceptInvitation({ token, name, password })`.
- [ ] On success: `router.replace('/dashboard')`.
- [ ] On invalid/expired token: renders an inline error with a "Contact your administrator for a new invite" message.
- [ ] Error handling via `translateAuthError` + `sonner` — covers `INVITATION_EXPIRED`, `INVITATION_USED`, `INVITATION_NOT_FOUND`, `WEAK_PASSWORD`.

### Files to create / modify

- `apps/web/app/(auth)/accept-invitation/page.tsx` — new.

### Agent Execution Prompt

> Role: Senior React 19 engineer shipping FCM row #21.
> Context: FCM #21 (user invitations). The library's invitation flow issues a token via email; the recipient lands here. The page must pre-fetch the invite summary (so the user knows what they're accepting) before asking for credentials.
> Objective: Ship `app/(auth)/accept-invitation/page.tsx`.
> Steps: 1. Read `?token=`. 2. On mount, call `authClient.getInvitation(token)` and render a skeleton → summary → error states. 3. Build the form with `acceptInvitationSchema` (name, password, confirmPassword). 4. Submit via `authClient.acceptInvitation({ token, name, password })`. 5. Redirect to `/dashboard` on success. 6. Handle invalid/expired invites with a calm inline error state, not a crash.
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 and §13.
> - Form: `react-hook-form` + `zod`. Toasts: `sonner`. UI: `@/components/ui/*`.
> - Use the shared `<PasswordInput />` from P13-1.
> - Never log the token.
> - Do not render the form until the invite summary is resolved — this avoids users submitting credentials into an invalid invite.
>   Verification:
> - `pnpm --filter @nest-auth-example/web build` — expected: success.
> - Manual: admin invites a new email from Phase 14's `/dashboard/invitations` → Mailpit shows the invite link → open it → summary renders → set name + password → redirected to `/dashboard` signed in.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P13-8 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## Completion log
