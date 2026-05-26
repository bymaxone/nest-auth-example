# 🔐 Google OAuth — Setup Guide

This guide turns the **"Continue with Google"** button into a working sign-in flow against the real Google identity provider. The library wiring is already in place; this is the runtime configuration you need.

Estimated time: **~10 minutes** end-to-end.

---

## TL;DR

Enable Google OAuth in three steps:

1. Create an OAuth 2.0 client in [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Add three env vars to `apps/api/.env`:
   ```env
   OAUTH_GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com
   OAUTH_GOOGLE_CLIENT_SECRET=<client-secret>
   OAUTH_GOOGLE_CALLBACK_URL=http://localhost:4000/api/auth/oauth/google/callback
   ```
3. Set `NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED=true` in `apps/web/.env.local` and restart `pnpm dev`.

The button appears on `/auth/login` and `/auth/register` the moment the API restarts with the three vars present.

---

## 1. Create the OAuth client

### 1.1 Pick (or create) a project

1. Open [Google Cloud Console → Project selector](https://console.cloud.google.com/projectselector2/home/dashboard).
2. Use any existing project, or click **New Project** (top-right). The project is what scopes the OAuth client — it has no other implications for this example.

### 1.2 Configure the OAuth consent screen

Google requires the consent screen to be configured before you can issue OAuth credentials.

1. Open **APIs & Services → OAuth consent screen** ([direct link](https://console.cloud.google.com/apis/credentials/consent)).
2. Choose **External** (lets any Google account sign in). Click **Create**.
3. Fill the required fields:
   - **App name** — `nest-auth-example` (or whatever you want to show on the consent screen).
   - **User support email** — any address you own.
   - **Developer contact information** — same address is fine.
4. Click **Save and continue** through the Scopes and Test users pages. The default scopes (`email`, `profile`, `openid`) are exactly what the library requests — you do not need to add anything.
5. On the **Test users** page, add your own Google account so you can sign in during development without publishing the app.
6. **Save and continue** to the summary.

> [!NOTE]
> The app stays in **Testing** mode forever until you submit it for verification. That is fine for local development — only the email addresses you added as test users can sign in.

### 1.3 Create the OAuth 2.0 client ID

1. Open **APIs & Services → Credentials** ([direct link](https://console.cloud.google.com/apis/credentials)).
2. Click **+ Create credentials → OAuth client ID**.
3. **Application type:** `Web application`.
4. **Name:** anything you'll recognise, e.g. `nest-auth-example (local)`.
5. Under **Authorized redirect URIs**, click **Add URI** and paste:
   ```
   http://localhost:4000/api/auth/oauth/google/callback
   ```
   > This must match `OAUTH_GOOGLE_CALLBACK_URL` exactly — Google rejects mismatched URIs.
6. Leave **Authorized JavaScript origins** empty (the library does not use the implicit flow).
7. Click **Create**.

Google now shows your **Client ID** and **Client secret**. Keep this tab open — you will paste them into the `.env` in the next step.

---

## 2. Wire up the environment

### 2.1 Backend — `apps/api/.env`

Add (or uncomment) three lines:

```env
# Google OAuth (all three must be set together — Zod refuses to start the app otherwise)
OAUTH_GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com
OAUTH_GOOGLE_CLIENT_SECRET=<client-secret>
OAUTH_GOOGLE_CALLBACK_URL=http://localhost:4000/api/auth/oauth/google/callback
```

Validation rules enforced by [`apps/api/src/config/env.schema.ts`](../apps/api/src/config/env.schema.ts):

- All three are optional — leave them out to keep OAuth disabled.
- If `CLIENT_ID` is set, `CLIENT_SECRET` and `CALLBACK_URL` are required.
- The callback URL must be reachable from the browser AND registered with Google as an authorized redirect URI.

### 2.2 Frontend — `apps/web/.env.local`

Flip the flag the UI checks:

```env
NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED=true
```

`NEXT_PUBLIC_*` vars are statically inlined at build time, so a `pnpm dev` restart is required for the flag to take effect.

---

## 3. Verify it works

1. Restart the stack:
   ```bash
   pnpm dev
   ```
2. Open http://localhost:3000/auth/login?tenantId=acme.
3. The **"Continue with Google"** button now appears below the form.
4. Click it — the browser navigates through `/api/auth/oauth/google?tenantId=acme` and is 302-redirected to Google's consent screen.
5. Sign in with one of the test users you added in step 1.2.
6. Google redirects back to `/api/auth/oauth/google/callback?code=…&state=…`. The library validates the state nonce, exchanges the code for tokens, fetches the profile, and creates (or links) the user.
7. You land on `/dashboard` with HttpOnly auth cookies set.

If the email of the Google account matches an existing user in the seeded tenant, the existing row is **linked** to the OAuth identity (FCM #12 account-linking behaviour). If not, a fresh user is created with `oauthProvider: 'google'`.

---

## 4. How the wiring fits together

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser                                                         │
│                                                                  │
│  Click "Continue with Google"                                    │
│  → GET /api/auth/oauth/google?tenantId=acme                      │
└─────────────────────────────┬────────────────────────────────────┘
                              │ 302 to accounts.google.com
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  accounts.google.com                                             │
│  • Consent screen                                                │
│  • Sign-in (your Google account)                                 │
└─────────────────────────────┬────────────────────────────────────┘
                              │ 302 back to OAUTH_GOOGLE_CALLBACK_URL
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  NestJS API — lib's OAuthController                              │
│                                                                  │
│  GET /api/auth/oauth/google/callback?code=…&state=…              │
│  1. Validate `state` nonce (consumes from Redis)                 │
│  2. POST https://oauth2.googleapis.com/token   (server-to-server)│
│  3. GET  https://www.googleapis.com/oauth2/v2/userinfo           │
│  4. Run `IAuthHooks.onOAuthLogin`                                │
│      → 'link'   if email already exists (account linking)        │
│      → 'create' otherwise                                        │
│  5. Issue access_token + refresh_token cookies                   │
└─────────────────────────────┬────────────────────────────────────┘
                              │ 302 to /dashboard
                              ▼
                          authenticated session
```

- **Initiate endpoint:** `GET /api/auth/oauth/:provider?tenantId=…` — mounted by the library when `oauth.google.*` are present in the config.
- **Callback endpoint:** `GET /api/auth/oauth/:provider/callback` — same lib controller.
- **Account-linking hook:** [`AppAuthHooks.onOAuthLogin`](../apps/api/src/auth/app-auth.hooks.ts) (`'link' | 'create'` strategy).
- **Repository write:** [`PrismaUserRepository.createWithOAuth`](../apps/api/src/auth/prisma-user.repository.ts) — uses Prisma `upsert` on `(tenantId, email)` so a parallel attempt cannot create a duplicate row.

---

## 5. Production checklist

When moving past local development:

- [ ] Submit the OAuth consent screen for **verification** (required to allow non-test-user accounts to sign in).
- [ ] Register the **production callback URL** under Authorized redirect URIs (e.g. `https://api.example.com/api/auth/oauth/google/callback`).
- [ ] Set `OAUTH_GOOGLE_CALLBACK_URL` in the production environment to that exact URL.
- [ ] **Never** commit `OAUTH_GOOGLE_CLIENT_SECRET` to source control. Use the platform's secret manager (Fly.io secrets, AWS SSM, Vercel env, etc.).
- [ ] If you serve the API and the web app on different subdomains, configure `cookies.resolveDomains` so the auth cookies remain valid after the callback. See [docs/DEPLOYMENT.md](./DEPLOYMENT.md).
- [ ] Rotate the Client Secret regularly. Google supports two active secrets per client so you can roll without downtime.

---

## 6. Testing

The OAuth flow is covered by **two complementary suites** — both run without ever calling real Google servers:

| Suite                    | Spec                                                                                                    | What it stubs                                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **API e2e** (supertest)  | [`apps/api/test/oauth-link.e2e-spec.ts`](../apps/api/test/oauth-link.e2e-spec.ts)                       | `installFakeGoogle()` ([test/helpers/fake-google.ts](../apps/api/test/helpers/fake-google.ts)) replaces `globalThis.fetch` to intercept `oauth2.googleapis.com/token` + `googleapis.com/oauth2/v2/userinfo`. Exercises both account-linking and new-account paths against a real DB. |
| **Web e2e** (Playwright) | [`apps/web/e2e/oauth-google-click-through.spec.ts`](../apps/web/e2e/oauth-google-click-through.spec.ts) | Clicks the button, asserts the browser is redirected to `accounts.google.com` with a well-formed authorization URL (client_id, scope, state, redirect_uri). Does not complete the OAuth handshake — proving the lib generates the correct outbound URL is enough at the UI layer.    |

> [!NOTE]
> A full browser-level Google handshake e2e would need to mock the `accounts.google.com/o/oauth2/v2/auth` consent page AND simulate Google's redirect back to the callback. That is out of scope for this example because (a) the API side is already covered against the same fake-Google stub used by the lib's own tests, and (b) running it would require monkey-patching the API process's `fetch` from the test harness — a level of test-mode coupling we deliberately avoid. The click-through assertion catches every UI regression (broken href, missing tenant param, disabled button) without needing the additional plumbing.

---

## 7. Troubleshooting

### `OAUTH_GOOGLE_CLIENT_ID and OAUTH_GOOGLE_CLIENT_SECRET must both be set or both be unset`

Zod rejected the env. Either set both vars or leave both empty/absent — the partial state is rejected at boot to prevent silent OAuth disablement in production.

### `Error 400: redirect_uri_mismatch` on the Google consent screen

The `OAUTH_GOOGLE_CALLBACK_URL` value does not exactly match an entry under **Authorized redirect URIs** in your Google client config. Copy-paste the URL from the env into the Cloud Console field (or vice versa). Trailing slashes, `http://` vs `https://`, and port numbers must all match byte-for-byte.

### Button never appears in the UI

`NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED` is not `true`, or the value was set after `pnpm dev` started. `NEXT_PUBLIC_*` vars are inlined at build time — restart the dev server after changing them.

### `auth.oauth_initiate_failed` in the API logs

The lib could not reach `accounts.google.com` (network outage, firewall, DNS). Check connectivity from the API process.

### Existing account is not linked to the OAuth identity

Account linking happens **only when the Google profile's email exactly matches an existing `User.email`** in the same tenant. Mismatched casing is normalized by the lib (`email.toLowerCase()`), but a `+`-suffix alias (e.g. `bob+google@example.com` vs `bob@example.com`) is a different email and creates a new user.

---

## 8. Reference

- Library README: [@bymax-one/nest-auth](https://www.npmjs.com/package/@bymax-one/nest-auth)
- Lib source for the OAuth controller: `node_modules/@bymax-one/nest-auth/dist/server/index.d.ts` — search for `OAuthController`.
- Google Identity docs: https://developers.google.com/identity/protocols/oauth2/web-server
