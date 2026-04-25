# Features — nest-auth-example

> This document provides a running reference for every feature demonstrated in the application.
> It links back to the [Feature Coverage Matrix](OVERVIEW.md#6-feature-coverage-matrix) in `docs/OVERVIEW.md`.
>
> **Status:** This is a living stub. Complete prose, screenshots, and curl examples will be added in Phase 18.
> See [Phase 18 tasks](tasks/phase-18-documentation.md) for the full documentation roadmap.

---

## OAuth — Google

**FCM row:** #12 — OAuth Google sign-in & link  
**Status:** ✅ Backend wired (Phase 8)

### Environment Variables

| Variable                     | Required   | Example                                                | Notes                       |
| ---------------------------- | ---------- | ------------------------------------------------------ | --------------------------- |
| `OAUTH_GOOGLE_CLIENT_ID`     | Optional\* | `123...apps.googleusercontent.com`                     | All three required together |
| `OAUTH_GOOGLE_CLIENT_SECRET` | Optional\* | `GOCSPX-...`                                           | Must be set with CLIENT_ID  |
| `OAUTH_GOOGLE_CALLBACK_URL`  | Optional\* | `http://localhost:4000/api/auth/oauth/google/callback` | Must be set with CLIENT_ID  |

\*All three must be set together or all omitted. The Zod schema enforces mutual presence at startup.

### Google Cloud Console Setup

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com).
2. Enable the **Google Identity** API.
3. Under **OAuth consent screen**, configure app name and support email.
4. Under **Credentials → Create OAuth client ID**, choose **Web application**.
5. Add an authorized redirect URI:
   - Development: `http://localhost:4000/api/auth/oauth/google/callback`
   - Production: `https://<api-domain>/api/auth/oauth/google/callback`
6. Copy the Client ID and Client Secret into your `.env` file.

### Flow

1. Browser navigates to `GET /api/auth/oauth/google?tenantId=<tenantId>`.
2. The API generates a CSRF-protection `state` nonce, stores it in Redis (10-minute TTL), and redirects the browser to Google's consent page (`accounts.google.com/o/oauth2/v2/auth?...`).
3. User grants consent on Google.
4. Google redirects to `GET /api/auth/oauth/google/callback?code=<code>&state=<state>`.
5. The API validates the `state` (consumed atomically from Redis), exchanges `code` for an access token with Google, and fetches the user profile from `googleapis.com/oauth2/v2/userinfo`.
6. `AppAuthHooks.onOAuthLogin` is called:
   - If the email matches an existing user → `action: 'link'` (account-linking flow).
   - Otherwise → `action: 'create'` (new account provisioned with `emailVerified: true`).
7. The API issues `access_token` and `refresh_token` cookies and returns `{ user }`.

### Proxy Handoff (Next.js ↔ API)

The Next.js app runs on port 3000; the API on port 4000. Both the `NEXT_PUBLIC_API_URL` and `INTERNAL_API_URL` env vars are required:

- `NEXT_PUBLIC_API_URL=http://localhost:3000/api` — browser-visible URL (same origin via Next.js rewrite).
- `INTERNAL_API_URL=http://localhost:4000` — server-to-server URL for `createAuthProxy` middleware.

Next.js rewrites `/api/:path*` → `${INTERNAL_API_URL}/api/:path*` on the server side, so the OAuth redirect in step 4 above resolves correctly when following the location header from the browser. In production, the API and web app share a common registrable domain, and cookies are scoped via `cookies.resolveDomains` in `auth.config.ts`.

### Account Linking

If a user previously registered with email+password (`alice@example.com`) and later clicks "Continue with Google" using the same email:

- `onOAuthLogin` returns `{ action: 'link' }`.
- `userRepository.linkOAuth(userId, 'google', googleSubId)` updates the existing row.
- No duplicate user is created — `prisma.user.count({ where: { email } })` remains 1.

This behaviour is covered by the e2e spec at `apps/api/test/oauth-link.e2e-spec.ts`.

---

## Notifications (WebSocket)

**FCM row:** #24 — WebSocket auth + `WsJwtGuard`  
**Status:** ✅ Full loop wired (Phase 10 + Phase 16)

### End-to-end loop

```
User (browser)
  │  ws://localhost:3000/ws/notifications
  │  ← same-origin, access_token cookie forwarded automatically
  ▼
Next.js /ws/:path* rewrite
  │  ws://localhost:4000/ws/notifications (upgrade request + Cookie header)
  ▼
NotificationsGateway  (apps/api)
  │  reads JWT from Cookie: access_token (or Authorization: Bearer fallback)
  │  verifies via JwtService + rv:{jti} revocation check in Redis
  │  registers socket in userSockets map keyed by userId
  ▼
[connection open — gateway holds the socket]
  │
  │  POST /api/debug/notify/self  (dev only, any dashboard role)
  ▼
NotificationsController.notifySelf()
  │  extracts userId from verified JWT (@CurrentUser)
  │  calls gateway.emitNewNotification(userId, { title, body })
  ▼
NotificationsGateway.emitNewNotification()
  │  sends JSON `{ event: 'notification:new', data: { title, body } }` to all
  │  open sockets for that userId
  ▼
Browser ws-client singleton
  │  onmessage → dispatch('notification:new', payload)
  ▼
NotificationListener (React component in dashboard layout)
  │  handler: toast(payload.title, { description: payload.body })
  ▼
sonner toast visible to the user
```

### Demo (development only)

1. Start the full stack: `pnpm infra:up && pnpm dev`
2. Log in at `http://localhost:3000/auth/login`.
3. Navigate to **Dashboard → Account**.
4. Click **Send test notification**. A toast should appear within ~1 second.
5. The button is hidden in production builds (`process.env.NODE_ENV === 'production'`).

### Per-user isolation

Notifications are routed exclusively to the sockets owned by the requesting user's
`userId`. The `userSockets` map in `NotificationsGateway` is keyed by userId, not
tenantId or sessionId, so even an admin in the same tenant cannot receive
another user's notifications. The Playwright spec `e2e/notifications-isolation.spec.ts`
asserts this with two concurrent browser contexts.

### Key files

| File                                                              | Role                                       |
| ----------------------------------------------------------------- | ------------------------------------------ |
| `apps/api/src/notifications/notifications.gateway.ts`             | WS gateway — auth, routing                 |
| `apps/api/src/notifications/notifications.controller.ts`          | `notify/self` + `notify/:userId` triggers  |
| `apps/web/lib/ws-client.ts`                                       | Browser singleton with exponential backoff |
| `apps/web/components/notifications/notification-listener.tsx`     | Toast subscriber                           |
| `apps/web/components/dashboard/send-test-notification-button.tsx` | Demo button                                |

### Environment Variable

| Variable             | Required | Example               | Notes                                                    |
| -------------------- | -------- | --------------------- | -------------------------------------------------------- |
| `NEXT_PUBLIC_WS_URL` | Yes      | `ws://localhost:3000` | Same-origin URL; proxied to NestJS via `next.config.mjs` |

---

> **See Phase 18** for complete feature documentation including screenshots, full `curl` command sequences, and architecture diagrams.
> Phase 18 tasks: [`docs/tasks/phase-18-documentation.md`](tasks/phase-18-documentation.md)
