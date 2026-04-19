# Phase 20 — Coverage Audit & Hardening — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-20--coverage-audit--hardening) §Phase 20
> **Total tasks:** 4
> **Progress:** 🔴 0 / 4 done (0%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID | Task | Status | Priority | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| P20-1 | `scripts/audit-library-exports.mjs` + CI wiring | 🔴 | High | M | P19-1 |
| P20-2 | Close coverage gaps surfaced by the audit | 🔴 | High | M | P20-1 |
| P20-3 | Security pass — cookies, helmet, CSP, sanitization | 🔴 | High | M | Phase 17 |
| P20-4 | `CHANGELOG.md` 1.0.0 entry + `v1.0.0` local tag | 🔴 | High | S | P20-1, P20-2, P20-3 |

---

## P20-1 — `scripts/audit-library-exports.mjs` + CI wiring

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P19-1`

### Description
Node-only script that parses `node_modules/@bymax-one/nest-auth/dist/*/index.d.ts` (per subpath: server, shared, client, react, nextjs — per Appendix B of the plan), enumerates every exported symbol, then greps the `apps/` tree for each symbol. Exits non-zero with a diff listing missing exports. Wires into CI as the `export-usage-check` job already declared in `P19-1`. Pure Node (`node:fs`, `node:path`) — no bash, no jq.

### Acceptance Criteria
- [ ] `scripts/audit-library-exports.mjs` exists.
- [ ] Reads every `index.d.ts` under `node_modules/@bymax-one/nest-auth/dist/` (server/shared/client/react/nextjs) — subpaths discovered dynamically, not hardcoded.
- [ ] Parses exports via regex on `export` statements: covers `export { Foo }`, `export { Foo as Bar }`, `export type { Foo }`, `export const Foo`, `export class Foo`, `export function Foo`, `export interface Foo`, `export enum Foo`, `export default`.
- [ ] Scans `apps/api/src/**/*.{ts,tsx}` and `apps/web/**/*.{ts,tsx}` for each symbol (word-boundary match).
- [ ] Exits `0` when every symbol is referenced at least once; exits `1` with a grouped diff (`Missing in apps/: <subpath>.<symbol>`) otherwise.
- [ ] Honors an `.audit-ignore.json` file at the repo root listing intentionally-undemonstrated exports with justification.
- [ ] CI `export-usage-check` job runs `node scripts/audit-library-exports.mjs` and fails the build on non-zero exit.
- [ ] Runs in < 10 s on a typical workspace.
- [ ] Pure Node ESM — no external npm deps (uses only `node:fs`, `node:path`, `node:url`, `node:process`).

### Files to create / modify
- `scripts/audit-library-exports.mjs` — new.
- `.audit-ignore.json` — new (seeded with nothing; entries added per P20-2).
- `.github/workflows/ci.yml` — confirm `export-usage-check` calls the script (wire-up expected from P19-1).
- `package.json` — add `"audit:exports": "node scripts/audit-library-exports.mjs"` script.

### Agent Execution Prompt

> Role: Build/tooling engineer with TypeScript + Node fs experience.
>
> Context: `docs/DEVELOPMENT_PLAN.md` §20 (first bullet) + Appendix B (export → file map). The library ships subpaths: `server`, `shared`, `client`, `react`, `nextjs`. CI job `export-usage-check` already exists from P19-1; this task provides the script it runs.
>
> Objective: Prove at CI time that every public library export is consumed by `apps/`.
>
> Steps:
> 1. Discover subpaths: `fs.readdirSync('node_modules/@bymax-one/nest-auth/dist')` and filter to entries containing `index.d.ts`.
> 2. For each subpath, read `index.d.ts` as UTF-8. Collect symbols with a set of regexes:
>    - `/^\s*export\s+\{([^}]+)\}/gm` — split by comma, trim, handle `as` aliases (keep aliased name).
>    - `/^\s*export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|enum|type|namespace)\s+(\w+)/gm`.
>    - `/^\s*export\s+default\s+/gm` → record `<subpath>.default`.
>    - Skip re-exports from other npm packages.
> 3. Load `.audit-ignore.json` (object `{ "<subpath>.<symbol>": "reason" }`) and subtract those entries from the symbol set.
> 4. Walk `apps/api/src` and `apps/web` recursively, reading `.ts`/`.tsx` files. For each symbol, test with a word-boundary regex `new RegExp('\\b' + symbol + '\\b')`. Stop on first hit per symbol (fast exit).
> 5. Report missing symbols grouped by subpath, print a copy-pasteable `.audit-ignore.json` entry, and exit with status `0` (all good) or `1` (gaps).
> 6. Add `"audit:exports"` pnpm script to the root `package.json`.
> 7. Confirm `.github/workflows/ci.yml`'s `export-usage-check` job runs `node scripts/audit-library-exports.mjs` (update if not already wired).
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Pure Node ESM. No bash, no jq, no external npm deps.
> - Use only `node:fs`, `node:path`, `node:url`, `node:process`.
> - Script must be < 300 LOC and finish in < 10 s on a typical repo.
> - Never modify source files; this is a read-only audit.
>
> Verification:
> - `node scripts/audit-library-exports.mjs` — expected: prints a report; exit 0 if coverage is complete.
> - Delete a usage of `createAuthProxy` temporarily → expected: script exits 1 with `Missing in apps/: nextjs.createAuthProxy`.
> - `actionlint .github/workflows/ci.yml` — expected: no errors.
> - Runs in < 10 s on a typical workspace (time the command).

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P20-1 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P20-2 — Close coverage gaps surfaced by the audit

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P20-1`

### Description
Run `node scripts/audit-library-exports.mjs`, then for each missing export either (a) wire it into an existing module/page with a natural use-site, or (b) add an entry to `.audit-ignore.json` justifying why it is not demonstrated AND document the gap in `docs/FEATURES.md` with a GitHub issue reference. Script must exit 0 when done.

### Acceptance Criteria
- [ ] Every missing symbol reported by P20-1 is resolved.
- [ ] Each resolution is one of: (a) a real import+use in `apps/api/` or `apps/web/`, or (b) an `.audit-ignore.json` entry with a non-empty reason plus a matching `docs/FEATURES.md` note referencing a GitHub issue (`https://github.com/<owner>/nest-auth-example/issues/<n>`).
- [ ] `node scripts/audit-library-exports.mjs` exits `0` on a clean checkout.
- [ ] `.audit-ignore.json` has no entry without an issue link in FEATURES.md.
- [ ] Appendix B of `DEVELOPMENT_PLAN.md` cross-check: every row there has a real consumer (or ignore + issue).
- [ ] Unit test for the `NoOpAuthHooks` + `NoOpEmailProvider` fallbacks (Appendix B calls them out explicitly) exists under `apps/api/src/auth/`.

### Files to create / modify
- Various `apps/api/**` and `apps/web/**` files — wire missing symbols.
- `.audit-ignore.json` — additions where wiring is not appropriate.
- `docs/FEATURES.md` — "intentionally not demonstrated" subsections with issue links.
- `apps/api/src/auth/noop-fallbacks.spec.ts` — new, referencing `NoOpAuthHooks` and `NoOpEmailProvider`.

### Agent Execution Prompt

> Role: Senior full-stack engineer closing last-mile coverage gaps.
>
> Context: `docs/DEVELOPMENT_PLAN.md` §20 (second bullet) and Appendix B. The coverage rule from `OVERVIEW.md` §6 must hold.
>
> Objective: Drive the export audit to zero gaps.
>
> Steps:
> 1. Run `node scripts/audit-library-exports.mjs > audit-report.txt`. Review grouped output.
> 2. For each missing symbol, decide: demo-worthy OR genuinely not applicable?
>    - Demo-worthy: add a concrete usage. Prefer a light example (e.g., a guard listed on a single endpoint, a DTO validated in a test, a util in the logger middleware).
>    - Not applicable: open a GitHub issue explaining why, add `{ "<subpath>.<symbol>": "See #<n> – ..." }` to `.audit-ignore.json`, and append a bullet to the relevant `docs/FEATURES.md` section: "Intentionally not demonstrated — see #<n>".
> 3. For the Appendix B `NoOpAuthHooks` / `NoOpEmailProvider` fallbacks (explicitly flagged): add `apps/api/src/auth/noop-fallbacks.spec.ts` that imports both and verifies their contract (no-op behavior, returns-undefined / returns-resolved-promise).
> 4. Re-run the audit after each batch until exit `0`.
> 5. Commit granularly — one logical gap per commit — so reviewers can follow the reasoning.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Never add a symbol import solely to satisfy the audit — the use must be meaningful.
> - `.audit-ignore.json` entries without a `FEATURES.md` cross-reference are not accepted.
>
> Verification:
> - `node scripts/audit-library-exports.mjs` — expected: exit 0.
> - `pnpm --filter api test -- noop-fallbacks` — expected: green.
> - `pnpm typecheck && pnpm lint` — expected: green.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P20-2 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P20-3 — Security pass — cookies, helmet, CSP, sanitization

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `Phase 17`

### Description
Final security review per `docs/DEVELOPMENT_PLAN.md` §20 (third bullet). Audit cookie flags, apply `helmet` on `apps/api` and a security-header middleware on `apps/web` (HSTS, CSP, X-Content-Type-Options, Referrer-Policy), ensure `sanitizeHeaders` from the library is used wherever headers are logged, and reconfirm anti-enumeration on login error messages.

### Acceptance Criteria
- [ ] `apps/api/src/main.ts` registers `helmet()` with production-appropriate defaults (HSTS enabled in prod, frameguard, hidePoweredBy, noSniff, referrerPolicy).
- [ ] Cookie flags audited: `access_token` / `refresh_token` are `HttpOnly`; `Secure` in production; `SameSite=Lax` (or `Strict` where compatible); refresh cookie's `Path` scoped to `/api/auth`.
- [ ] `apps/web/middleware.ts` (or a `next.config.mjs` `headers()` block) sets `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`.
- [ ] Every place request/response headers are logged (Pino logger middleware, any error filter) passes them through `sanitizeHeaders` from `@bymax-one/nest-auth`.
- [ ] Anti-enumeration confirmed: login error uses `AUTH_ERROR_CODES.INVALID_CREDENTIALS` for both wrong-password and unknown-email paths; same for forgot-password (always 204/200 regardless of email existence). Covered by an e2e assertion.
- [ ] A new e2e spec `apps/api/test/security-headers.e2e-spec.ts` asserts helmet headers on a sample response.
- [ ] A new Playwright spec `apps/web/e2e/security-headers.spec.ts` asserts the web security headers.
- [ ] `docs/DEPLOYMENT.md` updated with the final header values.

### Files to create / modify
- `apps/api/src/main.ts` — add `helmet()`.
- `apps/api/src/logger/logger.middleware.ts` (or equivalent) — route logs through `sanitizeHeaders`.
- `apps/web/middleware.ts` or `apps/web/next.config.mjs` — add security headers.
- `apps/api/test/security-headers.e2e-spec.ts` — new.
- `apps/web/e2e/security-headers.spec.ts` — new.
- `docs/DEPLOYMENT.md` — document final values.

### Agent Execution Prompt

> Role: Application security engineer doing a pre-release hardening pass.
>
> Context: `docs/DEVELOPMENT_PLAN.md` §20 (third bullet). The library provides `sanitizeHeaders` — do not hand-roll.
>
> Objective: Ship production-grade defaults and assert them in tests.
>
> Steps:
> 1. Install `helmet` (dep of `apps/api`). In `main.ts`: `app.use(helmet({ hsts: nodeEnv === 'production', contentSecurityPolicy: false /* set on web */ }))`.
> 2. Cookie audit: open `auth.config.ts` and confirm `cookies.secure`, `sameSite`, `path` are correct per env. Document defaults in `docs/DEPLOYMENT.md`.
> 3. Web headers: prefer `apps/web/middleware.ts` adding headers via `NextResponse.next().headers.set(...)` for matched routes. CSP source list: `default-src 'self'; script-src 'self' 'unsafe-inline' (dev only); connect-src 'self' <API_URL> <WS_URL>; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none';`.
> 4. Audit every call site that logs headers; replace with `sanitizeHeaders(headers)`.
> 5. Anti-enumeration: grep for `USER_NOT_FOUND` / `EMAIL_NOT_FOUND` returned from login/forgot paths; replace with the generic `INVALID_CREDENTIALS` / 200 response.
> 6. Write `security-headers.e2e-spec.ts` asserting helmet headers; write `security-headers.spec.ts` asserting the web response headers.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Never log cookies, Authorization headers, or raw JWTs.
> - Never relax CSP in production.
> - Cite `sanitizeHeaders` from `@bymax-one/nest-auth` in every log sanitization call site.
>
> Verification:
> - `pnpm --filter api test:e2e -- security-headers` — expected: green.
> - `pnpm --filter web exec playwright test security-headers` — expected: green.
> - `curl -sI http://localhost:4000/api/health` — expected: `X-Content-Type-Options: nosniff`, `Strict-Transport-Security: ...` (in prod), no `X-Powered-By`.
> - Manual: wrong password and unknown email return identical status + body shape.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P20-3 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P20-4 — `CHANGELOG.md` 1.0.0 entry + `v1.0.0` local tag

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** S
- **Depends on:** `P20-1`, `P20-2`, `P20-3`

### Description
Add the initial `CHANGELOG.md` entry and create a local `v1.0.0` tag on `main`. This task documents the tagging procedure; the agent must NOT push the tag — a human operator does that after final review.

### Acceptance Criteria
- [ ] `CHANGELOG.md` has a `## [1.0.0] — YYYY-MM-DD` section with the line `initial reference app tracking @bymax-one/nest-auth@1.0.0`.
- [ ] Entry follows the Keep a Changelog structure (`Added`, `Changed`, `Fixed`, etc.) — at minimum an `Added` bullet list summarizing the 32 FCM rows.
- [ ] Local annotated tag `v1.0.0` exists on `main` (`git tag -a v1.0.0 -m "..."`).
- [ ] Tag is NOT pushed to the remote (documented; a human operator pushes).
- [ ] `docs/RELEASES.md` seeded with the `v1.0.0 · @bymax-one/nest-auth@1.0.0 · YYYY-MM-DD` row (cross-check with P18-10).
- [ ] Procedure section in `CHANGELOG.md` (or a short `docs/tasks/phase-20-audit-hardening.md` appendix) documents the tag+push steps for future releases.

### Files to create / modify
- `CHANGELOG.md` — new or updated with the 1.0.0 entry.
- `docs/RELEASES.md` — ensure the 1.0.0 row is present.
- (Local only) create annotated tag `v1.0.0`.

### Agent Execution Prompt

> Role: Release manager finalizing the 1.0.0 release artifacts.
>
> Context: `docs/DEVELOPMENT_PLAN.md` §20 (final two bullets). Tag must not be pushed automatically.
>
> Objective: Publish the changelog entry and a local tag ready for a human to push.
>
> Steps:
> 1. Verify all prior Phase 20 tasks are 🟢.
> 2. In `CHANGELOG.md`, add the `## [1.0.0] — YYYY-MM-DD` section at the top, following Keep a Changelog. Summarize FCM rows in an `### Added` list. Cite the library version in the opening line verbatim: `initial reference app tracking @bymax-one/nest-auth@1.0.0`.
> 3. Cross-check `docs/RELEASES.md` — if the 1.0.0 row is absent, add it with today's date.
> 4. Create the annotated tag locally: `git tag -a v1.0.0 -m "v1.0.0 — initial reference app tracking @bymax-one/nest-auth@1.0.0"`.
> 5. **Do not push.** Print the exact push command for the human operator: `git push origin v1.0.0`.
> 6. In `CHANGELOG.md` (bottom) or a `## Release procedure` section, document the future process: (a) land all gating work on `main`, (b) run the audit, (c) update CHANGELOG, (d) `git tag -a vX.Y.Z -m "..."`, (e) human operator runs `git push origin vX.Y.Z`, (f) `release.yml` handles the rest.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Never run `git push --tags` or `git push origin v1.0.0` — a human operator must push.
> - The tag message must be stable (no placeholder dates inside the message).
> - Prefer creating a new commit for `CHANGELOG.md` + `RELEASES.md` rather than amending.
>
> Verification:
> - `git tag --list v1.0.0` — expected: shows the tag locally.
> - `git for-each-ref --format='%(refname:short) %(taggername)' refs/tags/v1.0.0` — expected: annotated tag (non-empty tagger).
> - `git ls-remote --tags origin v1.0.0` — expected: NOT present on remote.
> - `grep -n '^## \[1\.0\.0\]' CHANGELOG.md` — expected: one match.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P20-4 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## Completion log
