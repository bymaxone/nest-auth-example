# PR Review Guidelines

What reviewers look for and what authors prepare. Applies to every non-trivial PR — including agent-generated ones.

---

## When to read this

Before approving, requesting changes, or merging a pull request. Authors should skim the checklist before asking for review.

---

## Author's pre-submission checklist

Tick before requesting review. An agent preparing a PR must also run this list.

- [ ] **Scope**: the PR addresses **one** concern. Opportunistic refactors split out.
- [ ] **CI green**: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check` all pass locally.
- [ ] **No banned patterns**: `any`, `@ts-ignore`, `eslint-disable`, `console.log`, commented-out code.
- [ ] **Docs updated**: file headers, JSDoc on new exports, scenario comments on new `it` blocks. See [coding-style.md § Code documentation](coding-style.md#code-documentation--mandatory).
- [ ] **User-facing strings**: routed through i18n keys when applicable; no hardcoded UI strings.
- [ ] **Security**: see the "Security sweep" below.
- [ ] **Privacy**: no PII / secrets in logs, audit rows, or fixtures.
- [ ] **Tests added or updated**: every behavior change has a new or updated test. Non-auth bug fixes get a regression test.
- [ ] **Migrations reviewed**: schema changes include a migration, generated SQL inspected, destructive changes flagged.
- [ ] **No accidental dependency bumps**: `pnpm-lock.yaml` changes only where the PR description says they would.
- [ ] **Screenshots / recordings** for UI changes.
- [ ] **Risks & follow-ups** section filled in when applicable.

---

## Reviewer checklist

### 1. Scope and intent

- Does the PR description state the _why_? Code review is judging a solution; a solution is only judgeable if the problem is clear.
- Does the diff match the description? Unannounced side quests block merge.
- Is the boundary right? (Feature vs infra vs docs.)

### 2. Architecture

- Layers respected: controllers thin, services pure, repositories not importing services, UI not importing services.
- No cross-feature imports; shared code is in `apps/*/src/` top-level modules or future `packages/`.
- DTO → service signature → repository contract — each layer is narrower.
- Error flow intentional: library exceptions not re-wrapped; app exceptions bubble to the global filter.

### 3. Library consumption

- `@bymax-one/nest-auth` calls match the patterns in [nest-auth-guidelines.md](nest-auth-guidelines.md).
- Library-shipped decorators used, not re-implemented.
- `AUTH_ERROR_CODES` used for auth errors instead of bespoke codes.
- No reshaping of library-owned objects (`User`, `PlatformUser`, JWT payloads).

### 4. Data

- Prisma schema: indexes on every FK, `@@unique([tenantId, …])` where multi-tenancy applies.
- Migrations: explicit names, no destructive drops in the same migration as a rename, review the generated SQL.
- Transactions used where atomicity matters; query shapes narrowed with `select`.
- Redis keys: prefix `nest-auth-example:app:` for app-owned; TTL on every write.

### 5. Security sweep

- Cookies: HttpOnly, `secure` derived from env, `sameSite: 'lax'`.
- CORS: single origin via `WEB_ORIGIN`.
- Validation: DTO or Zod at every boundary; no `@Body() body: any`.
- Authorization: `@Roles`, `@Public`, `@SkipMfa` correctly applied; no ad-hoc `req.user.role === …` checks inside controllers.
- No new secret material in code or logs. Redaction paths updated if a new sensitive field appears.
- No raw SQL concatenation; `$queryRaw` uses tagged templates.
- User input not concatenated into HTML, shell commands, redirect URLs.
- Tenant isolation preserved on every new query.

### 6. Observability

- Logs use Pino, structured, `event.name` style message.
- No logs of tokens, passwords, OTPs, `passwordHash`.
- Audit rows written for every new lifecycle event.
- `/health` still represents liveness of new dependencies (if any).

### 7. Frontend

- Server vs client boundaries respected; `'use client'` at the leaf.
- `credentials: 'include'` on any cross-origin fetch from `apps/web`.
- `<Link>` for internal navigation, `<Image>` for images.
- Accessibility: label + `htmlFor`, `aria-invalid`, focus ring, minimum touch target.
- Forms follow [forms-guidelines.md](forms-guidelines.md).

### 8. Tests

- Real Postgres + Redis for integration tests; no Prisma mocks in e2e.
- Query by role/label/text, not testids.
- No snapshot blobs.
- Each `it` has a scenario comment.
- Fake timers whenever dates/TTLs are asserted.

### 9. Docs

- Every new pattern documented.
- Guideline tables updated when a new guideline appears.
- README / OVERVIEW updated when user-visible behavior changes.
- `docs/RELEASES.md` updated if a library version pin moved.

### 10. CI, deps, tooling

- Lockfile changes justified in the description.
- No new dependency without a rationale.
- Images pinned (Compose).
- No hook bypasses (`--no-verify`).

---

## Approving

- "Approve" only after the checklist is satisfied.
- Nits → inline comment + "Non-blocking" prefix. Don't request changes for cosmetic preferences.
- If a change touches auth paths, ask a second reviewer.
- If uncertain about a library contract, link to the library's docs and ask for the author to back up the interpretation.

---

## Requesting changes

- Prefer "Request changes" over "Comment" when anything on the checklist fails. Clear state > polite fog.
- State the fix, not just the problem. "Move the validation into the DTO so the controller stays thin" beats "this is wrong."
- Batch comments into one review submission; drip comments dilute attention.

---

## Merging

- **Squash and merge**.
- Subject line preserves the Conventional Commits format.
- Let the author land it — reviewer merges only if time-sensitive and the author is AFK.

---

## Agent-authored PRs

Same bar as human PRs. Extra scrutiny on:

- **Hallucinated APIs** — a real import path, a real function, a real signature? Grep the codebase and the library dist.
- **Drifted conventions** — subtle divergence from how the rest of the codebase names / structures things.
- **Overlarge diffs** — agents sometimes "improve" unrelated files. Revert the noise, keep the intended change.
- **Missing regression tests** — many AI-produced fixes ship without a test that proves the bug existed.
- **Stale references** — doc links or type names the agent assumed exist. Click or grep.

---

## Done criteria

A PR is ready to merge when:

1. CI is green on the final commit.
2. At least one reviewer has approved.
3. The checklist above passes.
4. The author has responded to every comment (resolve or push back).
5. No new work has landed on `main` that the PR hasn't been rebased on top of.

---

## References

- [coding-style.md](coding-style.md)
- [git-workflow.md](git-workflow.md)
- [nest-auth-guidelines.md](nest-auth-guidelines.md)
- [security-privacy-guidelines.md](security-privacy-guidelines.md)
- [testing-guidelines.md](testing-guidelines.md)
