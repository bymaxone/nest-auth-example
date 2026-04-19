# Phase 10 — WebSocket Auth (Backend) — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-10--websocket-auth-backend) §Phase 10
> **Total tasks:** 3
> **Progress:** 🔴 0 / 3 done (0%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID    | Task                                               | Status | Priority | Size | Depends on   |
| ----- | -------------------------------------------------- | ------ | -------- | ---- | ------------ |
| P10-1 | Notifications gateway with `WsJwtGuard`            | 🔴     | High     | M    | Phase 7      |
| P10-2 | Dev-only `POST /api/debug/notify/:userId` endpoint | 🔴     | Medium   | S    | P10-1        |
| P10-3 | WebSocket auth e2e verification                    | 🔴     | High     | M    | P10-1, P10-2 |

---

## P10-1 — Notifications gateway with `WsJwtGuard`

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** Phase 7

### Description

Create `apps/api/src/notifications/notifications.gateway.ts` — a `@WebSocketGateway` at path `/ws/notifications` guarded by `WsJwtGuard` from `@bymax-one/nest-auth`. Reads the `access_token` cookie on upgrade, associates the connected socket with the authenticated user, and exposes an `emitNewNotification(userId, payload)` method that emits `notification:new` to that user's sockets. Covers FCM row **#24 (WebSocket auth + `WsJwtGuard`)**.

### Acceptance Criteria

- [ ] `apps/api/src/notifications/notifications.module.ts` exists and is imported by `app.module.ts`.
- [ ] `NotificationsGateway` decorated with `@WebSocketGateway({ path: '/ws/notifications', cors: { origin: env.WEB_ORIGIN, credentials: true } })` and `@UseGuards(WsJwtGuard)`.
- [ ] `handleConnection(client)` reads `client.user` (set by the library guard), stores `client.id` in an in-memory `Map<userId, Set<socketId>>`, and logs the connect (no PII).
- [ ] `handleDisconnect(client)` removes the socket from the map.
- [ ] Public method `emitNewNotification(userId: string, payload: { title: string; body: string })` iterates that user's sockets and emits `notification:new`. The handler is non-blocking (no `await` on I/O beyond the emit).
- [ ] When a `user.status` change hook fires (`afterUserStatusChanged` or equivalent), sockets belonging to a user whose status moved to a blocked value are disconnected (`client.disconnect(true)`).
- [ ] `WsJwtGuard` imported exactly as `WsJwtGuard` from `@bymax-one/nest-auth`.

### Files to create / modify

- `apps/api/src/notifications/notifications.module.ts` — new module.
- `apps/api/src/notifications/notifications.gateway.ts` — new gateway.
- `apps/api/src/app.module.ts` — import `NotificationsModule`.
- `apps/api/src/auth/app-auth.hooks.ts` — add status-change disconnect trigger (calls gateway).

### Agent Execution Prompt

> Role: NestJS engineer familiar with `@nestjs/websockets`, `WsJwtGuard` from `@bymax-one/nest-auth`, and non-blocking gateway patterns.
>
> Context: FCM row #24. The library's `WsJwtGuard` validates the JWT carried in the `access_token` cookie on the HTTP upgrade request. The gateway itself is host-owned.
>
> Objective: Mount a guarded notifications gateway, track user-to-socket mappings, and expose an emit method.
>
> Steps:
>
> 1. Create `NotificationsModule` importing `AuthModule` (for the guard's dependencies). Declare `NotificationsGateway` as a provider and export it so the debug controller (P10-2) can inject it.
> 2. In `NotificationsGateway`, inject nothing heavy — store the `Map<string, Set<string>>` as a private field.
> 3. Use `@UseGuards(WsJwtGuard)`. Consult the library README for whether the guard must be applied at `handleConnection` or via `afterInit` — default to `handleConnection`.
> 4. Implement `handleConnection`, `handleDisconnect`, and `emitNewNotification` as described. Keep every method O(1) per socket; no `await` for disk or network.
> 5. Wire a disconnect path for status changes: in `AppAuthHooks.afterUserStatusChanged` (or closest equivalent), if the new status is in `blockedStatuses`, call `gateway.disconnectUser(userId)` which iterates sockets and calls `disconnect(true)`.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (ESM, strict TS).
> - Cite `WsJwtGuard` from `@bymax-one/nest-auth` — do not hand-roll JWT parsing.
> - The gateway handler must be non-blocking: no synchronous DB calls, no awaited I/O on the connection path beyond what the guard already performs.
> - Never log JWTs, cookies, or user PII.
>
> Verification:
>
> - `pnpm --filter api typecheck` — expected: green.
> - `pnpm --filter api dev`, then `websocat ws://localhost:4000/ws/notifications` without a cookie — expected: immediate close (403/unauthorized).
> - With a valid cookie (dev login first), the connection stays open.

### Completion Protocol

1. ✅ Set Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P10-1 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P10-2 — Dev-only `POST /api/debug/notify/:userId` endpoint

- **Status:** 🔴 Not Started
- **Priority:** Medium
- **Size:** S
- **Depends on:** `P10-1`

### Description

Add a development-only controller that pushes a notification through the gateway for a given `userId`. The route must be registered only when `NODE_ENV !== 'production'`. Covers FCM row **#24** (driver for manual + e2e tests).

### Acceptance Criteria

- [ ] `apps/api/src/notifications/notifications.controller.ts` exposes `POST /api/debug/notify/:userId` with a JSON body `{ title: string, body: string }`.
- [ ] The handler is registered only when `NODE_ENV !== 'production'` — either by conditionally including the controller in `NotificationsModule` or by throwing `NotFoundException` inside the handler when in production (prefer the former).
- [ ] The route is guarded by `JwtAuthGuard` (dashboard auth) and requires `@Roles('ADMIN')`.
- [ ] On success (200), the gateway's `emitNewNotification(userId, body)` is called and returns `{ delivered: number }` indicating how many sockets received it.
- [ ] Request body validated with a `class-validator` DTO.

### Files to create / modify

- `apps/api/src/notifications/notifications.controller.ts` — new dev-only controller.
- `apps/api/src/notifications/notifications.module.ts` — conditionally include the controller.
- `apps/api/src/notifications/dto/notify.dto.ts` — new DTO.

### Agent Execution Prompt

> Role: NestJS engineer familiar with dev-only route gating and WebSocket gateways.
>
> Context: FCM row #24. E2E tests and manual demos need a way to push a notification on demand. The route must never exist in production bundles.
>
> Objective: Expose a dev-only push endpoint that drives the gateway.
>
> Steps:
>
> 1. Create `NotifyDto` with `@IsString() @MinLength(1) title` and `@IsString() @MinLength(1) body`.
> 2. Create `NotificationsController` under `/api/debug/notify`. Inject `NotificationsGateway`. Route: `@Post(':userId')`, param validation via `@IsUUID('4')` (or whatever the id format is — cuid; use `@IsString()` with regex if needed).
> 3. Apply `@UseGuards(JwtAuthGuard, RolesGuard)` and `@Roles('ADMIN')` at the class level.
> 4. In `NotificationsModule`, conditionally push the controller into the `controllers` array based on `process.env.NODE_ENV !== 'production'`. Document the condition in a comment.
> 5. Handler body: `const delivered = gateway.emitNewNotification(userId, dto); return { delivered };`.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - The handler must be non-blocking — the gateway's emit call is fire-and-forget and returns synchronously.
> - Guard against accidental production exposure: unit test the module's `controllers` array is empty when `NODE_ENV=production`.
>
> Verification:
>
> - `pnpm --filter api typecheck` — expected: green.
> - `NODE_ENV=production pnpm --filter api start`, then `curl -i -X POST http://localhost:4000/api/debug/notify/abc` — expected: `404`.
> - `NODE_ENV=development pnpm --filter api dev`, same curl with admin cookie + valid body — expected: `200` `{ delivered: N }`.

### Completion Protocol

1. ✅ Set Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P10-2 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P10-3 — WebSocket auth e2e verification

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P10-1`, `P10-2`

### Description

Write an e2e spec that connects to `/ws/notifications` with a valid cookie, receives a pushed message, then (in a second case) suspends the user and verifies the socket is disconnected. Use the `ws` npm package (lightweight) in the spec; optionally document a `websocat` command for manual runs. Covers FCM row **#24**.

### Acceptance Criteria

- [ ] `apps/api/test/websocket-auth.e2e-spec.ts` created.
- [ ] Happy-path test: log in via `POST /api/auth/login` to capture cookies → open a WebSocket to `ws://localhost:<port>/ws/notifications` with those cookies in the `Cookie` header → `POST /api/debug/notify/:userId` with admin creds → assert the socket receives a `notification:new` event with the expected payload within 2 s.
- [ ] Negative test: open the socket without cookies → expect immediate close with code 4401 (or whatever the library emits for unauthorized).
- [ ] Status-change test: log in a `MEMBER` user, open the socket, then call `PATCH /api/users/:id/status { status: 'SUSPENDED' }` as admin → assert the member's socket closes within 2 s.
- [ ] Test uses the `ws` npm package (not `socket.io-client`), since the gateway is plain WS.
- [ ] `websocat` command line documented in a leading comment for manual reproduction.

### Files to create / modify

- `apps/api/test/websocket-auth.e2e-spec.ts` — new spec.
- `apps/api/test/helpers/ws.ts` — helper that wraps `new WebSocket(url, { headers: { cookie } })` and exposes `onMessage`, `onClose` as promises.

### Agent Execution Prompt

> Role: NestJS engineer writing e2e tests for WebSocket auth.
>
> Context: FCM row #24. The gateway uses `WsJwtGuard` from `@bymax-one/nest-auth`, reads the `access_token` cookie on upgrade, and disconnects suspended users via the status-change hook wired in P10-1.
>
> Objective: Prove valid cookies allow connection + delivery, invalid cookies are rejected, and status suspension forcibly disconnects.
>
> Steps:
>
> 1. Bring up `docker-compose.test.yml`. Seed the DB.
> 2. Log in a seeded `MEMBER` user via supertest and capture the cookie string.
> 3. Connect with `new WebSocket('ws://localhost:<port>/ws/notifications', { headers: { Cookie: cookieString } })`. Wait for the `open` event.
> 4. Use a second supertest agent (admin) to call `POST /api/debug/notify/:userId` with a known payload.
> 5. Assert the member's socket received a message whose parsed JSON has `event === 'notification:new'` and the expected body within 2 s.
> 6. Negative case: open a socket without cookies. Assert `close` fires with a non-1000 code within 1 s.
> 7. Status case: with the member still connected, call `PATCH /api/users/:id/status { status: 'SUSPENDED' }` as admin. Assert the socket's `close` event fires within 2 s.
> 8. Document at the top of the spec: `# manual: websocat --header "Cookie: access_token=..." ws://localhost:4000/ws/notifications`.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Use the `ws` npm package for the client (plain WebSocket). Do not pull in `socket.io-client` unless the gateway turns out to use Socket.IO.
> - Cite `WsJwtGuard` from `@bymax-one/nest-auth` in the spec's header comment.
> - Test must be non-flaky — use `Promise.race` with generous (2 s) timeouts.
>
> Verification:
>
> - `pnpm --filter api test:e2e -- websocket-auth` — expected: green.
> - Remove `@UseGuards(WsJwtGuard)` from the gateway → expected: the negative test fails (proving the guard is required).

### Completion Protocol

1. ✅ Set Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P10-3 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## Completion log
