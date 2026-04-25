# Phase 8 — OAuth (Google) & Invitations Backends — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-8--oauth-google--invitations-backends) §Phase 8
> **Total tasks:** 5
> **Progress:** 🟢 5 / 5 done (100%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID   | Task                                                 | Status | Priority | Size | Depends on |
| ---- | ---------------------------------------------------- | ------ | -------- | ---- | ---------- |
| P8-1 | OAuth env wiring + conditional controller activation | 🟢     | High     | S    | Phase 7    |
| P8-2 | OAuth flow documentation stub                        | 🟢     | Medium   | S    | P8-1       |
| P8-3 | OAuth account-linking e2e spec                       | 🟢     | High     | M    | P8-1       |
| P8-4 | Invitations feature flag + hook audit                | 🟢     | High     | S    | Phase 7    |
| P8-5 | Invitations end-to-end e2e spec (Mailpit)            | 🟢     | High     | M    | P8-4       |

---

## P8-1 — OAuth env wiring + conditional controller activation

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S
- **Depends on:** Phase 7 (`auth.module.ts` already mounts `BymaxAuthModule.registerAsync`)

### Description

Register the three Google OAuth environment variables, activate the `oauth.google` block in `auth.config.ts` only when all three are present, and flip `controllers.oauth: true` in `AuthModule` using the same env-presence check. Covers Feature Coverage Matrix row **#12 (OAuth — Google sign-in & link)**.

### Acceptance Criteria

- [x] `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`, `OAUTH_GOOGLE_CALLBACK_URL` added to `.env.example` with `OAUTH_GOOGLE_CALLBACK_URL` defaulted to `http://localhost:4000/api/auth/oauth/google/callback`.
- [x] `apps/api/src/config/env.schema.ts` zod schema marks all three as optional strings; adds a refinement error if only one or two are set.
- [x] `buildAuthOptions` in `apps/api/src/auth/auth.config.ts` returns an `oauth: { google: { clientId, clientSecret, callbackUrl } }` block only when all three env vars are defined; otherwise the `oauth` key is omitted entirely.
- [x] `apps/api/src/auth/auth.module.ts` resolves `controllers.oauth` via the same helper (e.g., `isOAuthEnabled(config)`) so the library only mounts `/api/auth/oauth/google` + `/api/auth/oauth/google/callback` when credentials exist.
- [x] Typecheck and server boot succeed in both states (env set and env absent).

### Files to create / modify

- `/.env.example` — add the three variables.
- `apps/api/src/config/env.schema.ts` — extend zod schema.
- `apps/api/src/auth/auth.config.ts` — conditional `oauth.google` block.
- `apps/api/src/auth/auth.module.ts` — compute `controllers.oauth` dynamically.

### Agent Execution Prompt

> Role: NestJS engineer familiar with `@bymax-one/nest-auth` OAuth flow and zod-based config validation.
>
> Context: Phase 8 covers FCM row **#12 (OAuth Google sign-in & link)**. The library exposes OAuth only when `controllers.oauth: true` AND `oauth.google` is configured. The project must not crash for developers who have not set up Google credentials.
>
> Objective: Wire OAuth env vars, conditionally activate the `oauth.google` config block, and flip the controller flag when credentials exist.
>
> Steps:
>
> 1. Add `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`, `OAUTH_GOOGLE_CALLBACK_URL` to `.env.example` (see Appendix A of DEVELOPMENT_PLAN).
> 2. Extend the zod schema in `env.schema.ts` with three optional strings and a `.superRefine` check: either all three are set or none.
> 3. In `auth.config.ts`, compute `const oauthGoogle = cfg.OAUTH_GOOGLE_CLIENT_ID && cfg.OAUTH_GOOGLE_CLIENT_SECRET && cfg.OAUTH_GOOGLE_CALLBACK_URL ? { google: {...} } : undefined` and spread it into the returned options so the key is absent when undefined.
> 4. In `auth.module.ts`, use the same helper to compute `controllers.oauth` for the `BymaxAuthModule.registerAsync({ controllers: { ..., oauth: isOAuthEnabled } })` call.
> 5. Boot `pnpm --filter api dev` in both modes to confirm no startup error and `/api/auth/oauth/google` only exists when env is set.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (ESM, strict TS, dotenv-safe).
> - Never hit real Google in CI — see P8-3 for the mock strategy.
> - Do not hardcode credentials; read strictly from `ConfigService`.
>
> Verification:
>
> - `pnpm --filter api typecheck` — expected: green.
> - `pnpm --filter api dev` with env unset, then `curl -i http://localhost:4000/api/auth/oauth/google` — expected: `404`.
> - Set the three env vars, restart, then `curl -i http://localhost:4000/api/auth/oauth/google` — expected: `302` redirect to `accounts.google.com`.

### Completion Protocol

1. ✅ Set Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P8-1 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P8-2 — OAuth flow documentation stub

- **Status:** 🟢 Done
- **Priority:** Medium
- **Size:** S
- **Depends on:** `P8-1`

### Description

Add a short OAuth section to a new `docs/FEATURES.md` stub documenting the exact callback URL pattern and how cookies propagate via the Next.js proxy. The full `FEATURES.md` gets fleshed out in Phase 18 — this task only establishes the Google block so consumers configuring OAuth right after Phase 8 have a clear reference. Covers FCM row **#12**.

### Acceptance Criteria

- [x] `docs/FEATURES.md` created with a top matter linking back to `OVERVIEW.md` §6.
- [x] A `## OAuth — Google` section documents the three env vars, the Google Cloud Console "Authorized redirect URI" value (`http://localhost:4000/api/auth/oauth/google/callback` in dev), and the flow: browser → `/api/auth/oauth/google` → Google consent → callback → API sets cookies → 302 to web `/dashboard`.
- [x] An explanatory paragraph describes how `createAuthProxy` in `apps/web/proxy.ts` lets browser cookies set on port 4000 work transparently at port 3000 (via same registrable domain in prod; via Next rewrites in dev).
- [x] An explicit note that full feature documentation lands in Phase 18 (link to the phase task file).

### Files to create / modify

- `docs/FEATURES.md` — new file; OAuth section only.

### Agent Execution Prompt

> Role: Technical writer who has shipped NestJS + Next.js OAuth flows.
>
> Context: `nest-auth-example` is the reference app for `@bymax-one/nest-auth`. FCM row #12 (OAuth Google) must be discoverable via `docs/FEATURES.md` even before Phase 18's full documentation pass.
>
> Objective: Add an OAuth Google section to a new `docs/FEATURES.md` stub.
>
> Steps:
>
> 1. Create `docs/FEATURES.md` with a one-paragraph intro pointing at `OVERVIEW.md` §6.
> 2. Add `## OAuth — Google` with env var list, Google Cloud Console setup hints, and a numbered "flow" list.
> 3. Explain the proxy handoff: why `NEXT_PUBLIC_API_URL=/api` and `INTERNAL_API_URL=http://localhost:4000` are both required.
> 4. Close with a "See Phase 18 for complete docs" note.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Keep the stub short — no screenshots, no copy that duplicates Phase 18's planned content.
> - Do not document features other than Google OAuth in this file yet.
>
> Verification:
>
> - `grep -n 'OAuth — Google' docs/FEATURES.md` — expected: a matching line.
> - Manual review: all three env var names appear verbatim.

### Completion Protocol

1. ✅ Set Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P8-2 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P8-3 — OAuth account-linking e2e spec

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** M
- **Depends on:** `P8-1`

### Description

Write a supertest e2e spec that verifies the account-linking guarantee: a user who first registers with email+password, then completes Google OAuth with the same email, ends up on the **same** `users` row with `oauthProvider='google'` and `oauthProviderId` populated — not a duplicate row. Covers FCM row **#12** (linking half).

### Acceptance Criteria

- [x] `apps/api/test/oauth-link.e2e-spec.ts` created; runs against a real Postgres/Redis via `docker-compose.test.yml`.
- [x] Test flow: register email+password → verify email via OTP (reads from test `IEmailProvider`) → trigger OAuth callback with a **mocked** Google profile whose email matches the registered user.
- [x] Assertions: `prisma.user.count({ where: { email } })` stays at `1`; the row has `oauthProvider === 'google'` and a non-null `oauthProviderId`; no duplicate row is created.
- [x] Google network access is **stubbed** — `test/helpers/fake-google.ts` intercepts `globalThis.fetch` for Google token and UserInfo endpoints. CI never hits `accounts.google.com`.
- [x] Test suite registers under `pnpm --filter api test:e2e`.

### Files to create / modify

- `apps/api/test/oauth-link.e2e-spec.ts` — new e2e spec.
- `apps/api/test/helpers/fake-google.ts` — lightweight Express app or `nock` setup that responds to Google token + userinfo endpoints.
- `apps/api/test/jest-e2e.json` — register the new spec if needed.

### Agent Execution Prompt

> Role: NestJS engineer writing supertest e2e specs with mocked third-party providers.
>
> Context: FCM row #12 — account linking must be verified. The library is responsible for the linking logic; this spec is a regression guard. Real Google calls are forbidden in CI.
>
> Objective: Prove that OAuth login with a pre-existing email updates the existing user row instead of creating a duplicate.
>
> Steps:
>
> 1. Create `test/helpers/fake-google.ts` — start an ephemeral Express server on a random port. Implement `POST /token` (returns `{ access_token, id_token }`) and `GET /userinfo` (returns `{ sub, email, name, email_verified: true }`).
> 2. Before the suite, set `OAUTH_GOOGLE_CLIENT_ID=test`, `OAUTH_GOOGLE_CLIENT_SECRET=test`, `OAUTH_GOOGLE_CALLBACK_URL=http://localhost:<apiPort>/api/auth/oauth/google/callback`, and point the library's Google discovery/token URLs at the fake server (via env or `googleapis` mock). If the library has no override, stub with `nock`.
> 3. Register a user (`POST /api/auth/register`), verify the email (fetch OTP from the test email provider already wired in Phase 6).
> 4. Simulate the redirect back: `GET /api/auth/oauth/google/callback?code=<fake-code>&state=<state>`; the library exchanges the code against the fake server and should find-or-link the user.
> 5. Query Prisma directly: assert `count === 1` and `oauthProvider === 'google'`.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (strict TS, ESM).
> - Google dev creds can be stubbed with `googleapis`' mock server or a local fake OAuth endpoint; **do not hit real Google in CI**.
> - Clean up: reset Prisma + Redis between tests.
>
> Verification:
>
> - `pnpm --filter api test:e2e -- oauth-link` — expected: suite passes, no outbound call to `accounts.google.com`.
> - `grep -n 'oauthProvider' apps/api/test/oauth-link.e2e-spec.ts` — expected: at least one assertion.

### Completion Protocol

1. ✅ Set Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P8-3 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P8-4 — Invitations feature flag + hook audit

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S
- **Depends on:** Phase 7 (`AppAuthHooks` implemented in Phase 6)

### Description

Confirm `invitations.enabled: true` is active in `auth.config.ts` (set in Phase 6), verify the library auto-mounts `/api/auth/invitations` and `/api/auth/invitations/accept`, and ensure `AppAuthHooks.afterInvitationAccepted` writes an audit-log entry. Covers FCM row **#21 (User invitations)**.

### Acceptance Criteria

- [x] `auth.config.ts` explicitly returns `invitations: { enabled: true, tokenTtlSeconds: 172_800 }` (already set — task confirms and adds an inline comment citing FCM #21).
- [x] Booting the API with these options exposes `POST /api/auth/invitations` and `POST /api/auth/invitations/accept` — verified by a curl or automated route dump.
- [x] `AppAuthHooks.afterInvitationAccepted` writes to `AuditLog` with `event: 'invitation.accepted'`, a non-null `actorUserId`, and a payload including `userId`, `tenantId`, `role` (no `invitationId` — not exposed by library hook signature).
- [x] A unit test `apps/api/src/auth/app-auth.hooks.spec.ts` adds three cases calling `afterInvitationAccepted` and asserts the correct AuditLog row is created.

### Files to create / modify

- `apps/api/src/auth/auth.config.ts` — confirm + comment.
- `apps/api/src/auth/app-auth.hooks.ts` — verify/complete `afterInvitationAccepted`.
- `apps/api/src/auth/app-auth.hooks.spec.ts` — add unit test case.

### Agent Execution Prompt

> Role: NestJS engineer familiar with `@bymax-one/nest-auth` hooks (`IAuthHooks`) and the audit-log pattern used in this repo.
>
> Context: FCM row #21 (invitations). Most of the feature is library-owned; the host app only provides hooks and the admin-gated UI. This task nails down the backend hook.
>
> Objective: Confirm invitations are mounted, and make sure accepted invitations produce an audit-log row.
>
> Steps:
>
> 1. Open `auth.config.ts`; ensure the returned options include `invitations: { enabled: true, tokenTtlSeconds: 172_800 }` and annotate with `// FCM #21 — User invitations`.
> 2. Boot the API and run `curl -i -X POST http://localhost:4000/api/auth/invitations/accept -H 'content-type: application/json' -d '{}'` — expect a 400/401 (validation/auth) rather than 404.
> 3. Inspect `AppAuthHooks.afterInvitationAccepted`. If missing, implement: `await prisma.auditLog.create({ data: { event: 'invitation.accepted', tenantId, actorUserId: ctx.user.id, payload: { invitationId } } })`. Wrap in try/catch + log — never throw.
> 4. Add a unit test in `app-auth.hooks.spec.ts` using a Prisma mock (e.g., `jest-mock-extended`) that asserts `auditLog.create` was called with the expected event slug.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (ESM, strict TS).
> - Never persist raw invitation tokens in payloads.
> - Hook must be non-blocking — on DB failure, log and swallow.
>
> Verification:
>
> - `pnpm --filter api test -- app-auth.hooks` — expected: green.
> - `curl -i -X POST http://localhost:4000/api/auth/invitations/accept` — expected: not `404`.

### Completion Protocol

1. ✅ Set Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P8-4 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P8-5 — Invitations end-to-end e2e spec (Mailpit)

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** M
- **Depends on:** `P8-4`

### Description

Write a supertest e2e spec that drives the full invitation flow: an admin creates an invitation, Mailpit captures the email, the recipient calls accept with the token, and a new `users` row appears with the correct tenant and role. Covers FCM row **#21**.

### Acceptance Criteria

- [x] `apps/api/test/invitations.e2e-spec.ts` created.
- [x] Test logs in as a seeded `ADMIN` user, calls `POST /api/auth/invitations` with `{ email, role: 'MEMBER' }`, receives 201.
- [x] Fetches the email from Mailpit's HTTP API at `http://localhost:58025/api/v1/messages`, extracts the accept token from the message body using `extractInviteTokenFromHtml()` (regex `?token=<hex>`).
- [x] Calls `POST /api/auth/invitations/accept` with `{ token, name, password }`.
- [x] Asserts: a new `users` row exists with the invited email, `tenantId` matching the admin's tenant, `role === 'MEMBER'`, and `emailVerified === true`.
- [x] Cleans the Mailpit mailbox before/after (`DELETE /api/v1/messages`).
- [x] Integrates with `pnpm --filter api test:e2e`.

### Files to create / modify

- `apps/api/test/invitations.e2e-spec.ts` — new spec.
- `apps/api/test/helpers/mailpit.ts` — thin client for the Mailpit HTTP API (list, fetch body, delete all).

### Agent Execution Prompt

> Role: NestJS engineer writing supertest e2e specs that read captured emails from Mailpit.
>
> Context: FCM row #21 (invitations). Mailpit exposes an HTTP API on port 8025 (`/api/v1/messages`) for listing and fetching captured messages — perfect for e2e verification without hitting real SMTP inboxes.
>
> Objective: Prove the full invitation happy path end-to-end.
>
> Steps:
>
> 1. Create `test/helpers/mailpit.ts` with helpers: `await deleteAll()` → `DELETE /api/v1/messages`; `await findByTo(email)` → polls `GET /api/v1/messages` with `kind: 'containing', query: 'to:<email>'` and returns the message body HTML/text.
> 2. In `invitations.e2e-spec.ts`, before each test call `deleteAll()`.
> 3. Log in a seeded admin and call `POST /api/auth/invitations`.
> 4. Poll Mailpit until the invitation email arrives (max 5 s, 200 ms interval). Parse the token using the URL regex documented by `@bymax-one/nest-auth` (typically `?token=<hex>`).
> 5. Call `POST /api/auth/invitations/accept` with `{ token, name: 'Invited User', password: 'Passw0rd!Passw0rd' }`.
> 6. Query Prisma and assert the new row's `tenantId`, `role`, and `emailVerified`.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Use the Mailpit HTTP API at `localhost:8025/api/v1/messages` — do not shell out to `mailpit` binaries.
> - The test must be idempotent — delete the mailbox before and after.
>
> Verification:
>
> - `docker compose up -d mailpit postgres redis` then `pnpm --filter api test:e2e -- invitations` — expected: green.
> - `curl http://localhost:8025/api/v1/messages` — expected: empty list after suite.

### Completion Protocol

1. ✅ Set Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P8-5 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## Completion log

- P8-1 ✅ 2026-04-24 — OAuth env vars wired, conditional google block and controllers.oauth flag already implemented in Phase 7
- P8-2 ✅ 2026-04-24 — Created docs/FEATURES.md with OAuth Google section stub
- P8-3 ✅ 2026-04-24 — OAuth account-linking e2e spec; createWithOAuth upsert; blocked-status guard; fake-google.ts stub
- P8-4 ✅ 2026-04-24 — Invitations flag confirmed (FCM #21); afterInvitationAccepted hook verified; app-auth.hooks.spec.ts unit tests; BLOCKED_USER_STATUSES typed as UserStatus[]; isBlockedStatus helper; post-upsert status guard (TOCTOU fix)
- P8-5 ✅ 2026-04-24 — invitations.e2e-spec.ts (happy path + 2 sad paths); extractInviteTokenFromHtml helper; pre-upsert blocked-status guard in createWithOAuth; onOAuthLogin unit tests (3 paths); prisma-user.repository.spec.ts (5 tests)
