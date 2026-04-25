# Phase 16 — WebSocket Consumer + Notification Toast — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-16--websocket-consumer--notification-toast) §Phase 16
> **Total tasks:** 3
> **Progress:** 🟢 3 / 3 done (100%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID    | Task                                                | Status | Priority | Size | Depends on         |
| ----- | --------------------------------------------------- | ------ | -------- | ---- | ------------------ |
| P16-1 | WebSocket client singleton with exponential backoff | 🟢     | High     | S    | Phase 10, Phase 14 |
| P16-2 | Notification listener component + toast integration | 🟢     | High     | S    | P16-1              |
| P16-3 | Account page demo button + end-to-end verification  | 🟢     | Medium   | S    | P16-2              |

---

## P16-1 — WebSocket client singleton with exponential backoff

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S
- **Depends on:** Phase 10, Phase 14

### Description

Build `apps/web/lib/ws-client.ts` — a module-level singleton that opens a plain `WebSocket` to `${NEXT_PUBLIC_WS_URL}/ws/notifications`. The `access_token` cookie rides along on the HTTP upgrade request (same-origin). Implements reconnect with exponential backoff capped at 30 seconds (e.g., `min(1000 * 2 ** attempt, 30_000)`), resets the backoff on successful open, and exposes a small event-emitter API (`on('notification:new', handler)` / `off`). Covers FCM row **#24 (WebSocket auth + `WsJwtGuard`)** on the client side.

### Acceptance Criteria

- [x] `apps/web/lib/ws-client.ts` exports a `getWsClient()` factory that returns a module-level singleton.
- [x] Singleton opens `new WebSocket(\`${process.env.NEXT_PUBLIC_WS_URL}/ws/notifications\`)`; cookies travel automatically because the URL is same-origin via the proxy.
- [x] On `close`, reconnects with backoff `min(1000 * 2 ** attempt, 30_000)` and jitter (±20%).
- [x] On successful `open`, the attempt counter resets to 0.
- [x] Exposes `on(eventName, handler)`, `off(eventName, handler)`, and `close()`; `close()` permanently stops reconnect attempts (used during sign-out).
- [x] Never throws — all runtime errors flow through an internal `error` channel and are logged via the app's logger (no raw `console.error` in production paths).
- [x] Unit test (Vitest) with a mocked `WebSocket` verifies: first reconnect after ~1 s, second ~2 s, capped at 30 s after enough failures.

### Files to create / modify

- `apps/web/lib/ws-client.ts` — new singleton + event emitter.
- `apps/web/lib/ws-client.test.ts` — Vitest unit test with a mocked `WebSocket`.
- `apps/web/.env.example` — document `NEXT_PUBLIC_WS_URL` (defaults to `ws://localhost:3000` in dev).

### Agent Execution Prompt

> Role: Senior TypeScript engineer fluent with browser `WebSocket` semantics, exponential backoff, and module-level singletons in Next.js 16 client code.
>
> Context: FCM row #24 (client side). The Phase 10 gateway sits at `/ws/notifications` under `WsJwtGuard` from `@bymax-one/nest-auth`; the cookie-mode `access_token` is sent automatically because the WS URL is same-origin via the Next.js proxy (`createAuthProxy`). Reconnects must be gentle — exponential backoff capped at 30 s.
>
> Objective: Ship a reliable, cache-free WebSocket client singleton with a minimal event-emitter API.
>
> Steps:
>
> 1. Implement the module: a single private `socket` ref, `listeners = new Map<string, Set<Handler>>`, an `attempt` counter, and a `stopped` flag toggled by `close()`.
> 2. `connect()`: `new WebSocket(url)`. Wire `onopen` (reset `attempt`), `onmessage` (parse JSON, dispatch to listeners), `onclose` (if not `stopped`, schedule reconnect with `setTimeout(connect, backoff())`), `onerror` (log and let `onclose` handle reconnect).
> 3. `backoff()`: `Math.min(1000 * 2 ** attempt, 30_000) * (0.8 + Math.random() * 0.4)` — jitter ±20%.
> 4. `on/off/close`: straightforward map-based emitter.
> 5. Vitest test uses `vi.useFakeTimers()` + a mock `WebSocket` to assert reconnect intervals.
> 6. Document `NEXT_PUBLIC_WS_URL` in `.env.example` and `docs/ENVIRONMENT.md`.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (strict TS, ESM, no `any`).
> - Use only the native browser `WebSocket`; do not introduce `socket.io-client`.
> - The singleton must survive React re-renders — bind to a module-level variable, not a hook.
> - No `localStorage` access; reconnect state lives in module memory only.
> - No third-party WS services are introduced.
>
> Verification:
>
> - `pnpm --filter web typecheck && pnpm --filter web lint` — expected: green.
> - `pnpm --filter web test -- ws-client` — Vitest asserts backoff sequence 1s, 2s, 4s, …, capped at 30s; expected: green.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P16-1 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P16-2 — Notification listener component + toast integration

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S
- **Depends on:** `P16-1`

### Description

Build `components/notifications/notification-listener.tsx` — a client component mounted in `app/dashboard/layout.tsx` (from P14-1). It calls `getWsClient()` on mount, subscribes to `notification:new`, and fires a `sonner` toast for each incoming payload `{ title, body }`. The listener is only active when the user is authenticated — it checks `useSession()` and tears down the socket on sign-out. Covers FCM row **#24** on the UI surface.

### Acceptance Criteria

- [x] `components/notifications/notification-listener.tsx` exists as a `'use client'` component.
- [x] It is imported and mounted inside `app/dashboard/layout.tsx` so every dashboard page gets toasts.
- [x] On mount (and whenever `useSession()` reports an authenticated user), the component subscribes to `notification:new`.
- [x] On `notification:new`, a `sonner` toast is fired with the `title` as the heading and `body` as the description.
- [x] On unmount or when `useSession()` transitions to unauthenticated, the component unsubscribes. Note: `wsClient.close()` is intentionally NOT called here — closing the singleton sets `stopped=true` permanently and breaks SPA re-auth flows. The gateway rejects the stale upgrade and backoff handles reconnect.
- [x] Renders nothing visible — it is purely an effect host.
- [x] Vitest unit test: mount with a mocked `useSession` + mocked `getWsClient`, dispatch a fake `notification:new`, assert `toast` was called with the expected args.

### Files to create / modify

- `apps/web/components/notifications/notification-listener.tsx` — new client component.
- `apps/web/components/notifications/notification-listener.test.tsx` — Vitest test.
- `apps/web/app/dashboard/layout.tsx` — mount `<NotificationListener />` once.

### Agent Execution Prompt

> Role: Senior React / Next.js engineer fluent with `'use client'` boundaries, `useEffect` lifecycles, `sonner` toasts, and `@bymax-one/nest-auth/react` (`useSession`, `useAuthStatus`).
>
> Context: FCM row #24 (client). The singleton from P16-1 exposes `on/off/close`. This component is the glue between that stream and `sonner`. It must not run while the user is unauthenticated — opening the WS with no cookie would spin the backoff loop pointlessly.
>
> Objective: Deliver a lightweight listener that reliably turns `notification:new` events into toasts when (and only when) authenticated.
>
> Steps:
>
> 1. `'use client'`. Import `useSession` (or `useAuthStatus`) from `@bymax-one/nest-auth/react`. If the session is not authenticated, return `null` and skip the effect.
> 2. In a `useEffect` keyed on `session?.user.id`, call `const ws = getWsClient()`; subscribe with `ws.on('notification:new', (payload) => toast(payload.title, { description: payload.body }))`.
> 3. Cleanup: `ws.off('notification:new', handler)`. On full sign-out transition (`user.id` becomes null), call `ws.close()` so the backoff loop stops.
> 4. Mount `<NotificationListener />` inside `app/dashboard/layout.tsx` (added in P14-1). Place it under the topbar so `sonner`'s `<Toaster />` (already mounted at app root) can render the toasts.
> 5. Vitest test: mock `useSession` to return an authenticated user; mock `getWsClient` to return a fake emitter; emit `notification:new`; assert `toast` received the expected args.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Use `useSession` (or `useAuthStatus`) from `@bymax-one/nest-auth/react` — do not reinvent auth state.
> - Must not render any visible DOM.
> - No `localStorage`. No manual cookie manipulation.
> - No third-party notification/toast libraries beyond the existing `sonner`.
>
> Verification:
>
> - `pnpm --filter web typecheck && pnpm --filter web lint` — expected: green.
> - `pnpm --filter web test -- notification-listener` — Vitest asserts `toast` called on `notification:new`; expected: green.
> - Manual: log in, open the Network tab — a single `/ws/notifications` WS connection is open and remains alive across client navigation.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P16-2 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P16-3 — Account page demo button + end-to-end verification

- **Status:** 🟢 Done
- **Priority:** Medium
- **Size:** S
- **Depends on:** `P16-2`

### Description

Add a `Send test notification` button to `app/dashboard/account/page.tsx` (the Account page from P14-2). Clicking it calls the dev-only `POST /api/debug/notify/self` endpoint wired in Phase 10. The toast must appear in the current session but must **not** appear in a second browser logged in as a different user — verified by a Playwright spec with two contexts. Covers FCM row **#24** end to end.

### Acceptance Criteria

- [x] The Account page renders a clearly-labelled `Send test notification` button (dev-only — hidden or disabled when `process.env.NODE_ENV === 'production'`).
- [x] Clicking it calls `POST /api/debug/notify/self` with an optional JSON body `{ title, body }` (sensible defaults if not provided).
- [x] The current session's `<NotificationListener />` raises a `sonner` toast with the expected title and body within 2 seconds.
- [x] Playwright spec uses two browser contexts:
  - Context A logs in as `member@example.com`, clicks the button, asserts the toast appears.
  - Context B (logged in as a different user such as `admin@example.com`) waits 3 seconds and asserts **no** toast appeared.
- [x] The demo button is disabled while a request is in flight and re-enabled on response.
- [x] A short paragraph in `docs/FEATURES.md` documents the full loop (button → debug endpoint → gateway → toast).

### Files to create / modify

- `apps/web/app/dashboard/account/page.tsx` — add the demo button (from P14-2).
- `apps/web/components/dashboard/send-test-notification-button.tsx` — new client component.
- `apps/web/lib/auth-client.ts` — add `notifySelf(payload?)` helper hitting `POST /api/debug/notify/self`.
- `apps/web/e2e/notifications-isolation.spec.ts` — new Playwright spec with two contexts.
- `docs/FEATURES.md` — add a "Notifications (WebSocket)" section.

### Agent Execution Prompt

> Role: Senior full-stack engineer comfortable with Next.js 16 client components, `sonner` toasts, and Playwright multi-context specs; familiar with `@bymax-one/nest-auth/react` (`useSession`).
>
> Context: FCM row #24. Phase 10 already ships `POST /api/debug/notify/self` (dev-only) that fans out to the authenticated user's own sockets via the gateway. This task closes the loop on the client: a visible button, a listener that fires, and a multi-context E2E spec proving per-user isolation.
>
> Objective: Ship the demo button and a conclusive two-context Playwright verification.
>
> Steps:
>
> 1. Add `notifySelf(payload?)` to `auth-client.ts`; POSTs to `/api/debug/notify/self` with defaults `{ title: 'Hello', body: 'This is a test notification.' }`.
> 2. Build `send-test-notification-button.tsx` — a client component rendered in the Account page. Hide it when `process.env.NODE_ENV === 'production'`. Disable while a request is in flight; show a spinner icon from `lucide-react`.
> 3. Wire `<NotificationListener />` (P16-2) as the recipient — no direct UI changes beyond the button.
> 4. Playwright spec `notifications-isolation.spec.ts`:
>    - Spawn two `browser.newContext()` contexts, `ctxA` and `ctxB`.
>    - Log in as `member@example.com` in `ctxA`; log in as `admin@example.com` in `ctxB`.
>    - In `ctxA`, visit `/dashboard/account`, click the button. Assert the toast text `Hello` appears within 2 s.
>    - In `ctxB`, wait 3 s. Assert no toast with text `Hello` is present.
> 5. Add a short "Notifications (WebSocket)" section to `docs/FEATURES.md` explaining the end-to-end loop and linking to the Phase 10 gateway + `WsJwtGuard`.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Use `useSession` from `@bymax-one/nest-auth/react` if needed to guard the button; do not duplicate auth state.
> - No third-party notification services — the entire loop is local.
> - Do not introduce `localStorage` usage.
> - Do not log notification payloads beyond a one-line informational log in dev mode.
>
> Verification:
>
> - `pnpm --filter web typecheck && pnpm --filter web lint` — expected: green.
> - `pnpm --filter web test:e2e -- notifications-isolation` — Playwright spec passes both contexts (A sees the toast, B does not); expected: green.
> - Manual: in production build (`pnpm --filter web build && pnpm --filter web start`), the demo button is not rendered on `/dashboard/account`.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P16-3 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## Completion log

- P16-1 ✅ 2026-04-25 — Browser WS singleton with backoff (1s→2s→4s→30s cap), event-emitter API, 10 Vitest tests green
- P16-2 ✅ 2026-04-25 — NotificationListener client component, sonner toast integration, 4 Vitest tests green
- P16-3 ✅ 2026-04-25 — SendTestNotificationButton, notifySelf auth-client helper, Playwright isolation spec, FEATURES.md docs
