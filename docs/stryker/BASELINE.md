# Stryker Mutation Testing — Baseline (Phase 0)

> **Recorded**: 2026-05-26
> **Commit**: `08a2167` (`feat(mfa): implement tenant-level MFA enforcement and silent workspace switching`)
> **Hardware**: macOS Darwin 25.5.0
> **Node**: v24.16.0
> **Stryker**: `@stryker-mutator/core@9.6.1`
> **Concurrency**: 4 per workspace
> **Thresholds at baseline time**: `{ high: 95, low: 85, break: null }` (no CI gate)

This document captures the **first** measurement of mutation score after wiring
Stryker into the monorepo. Phase 1 hardening should improve every "Survived"
number below; track the running history in
[`HISTORY.md`](./HISTORY.md) and the rollout strategy in
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).

---

## Summary

| Workspace  | Score (total) | Score (covered) | Killed | Survived | Timed out | No coverage | Errors | Mutants | Runtime |
| ---------- | ------------- | --------------- | ------ | -------- | --------- | ----------- | ------ | ------- | ------- |
| `apps/api` | **75.03%**    | 75.03%          | 606    | 202      | 1         | 0           | 573    | 1382    | 5m 59s  |
| `apps/web` | **67.89%**    | 67.93%          | 1161   | 548      | 0         | 1           | 6      | 1716    | 8m 30s  |

**Score formulas (Stryker):**

- `covered` = killed / (killed + survived + timeout)
- `total` = killed / (killed + survived + timeout + no-coverage)

**About the "Errors" column on `apps/api`**: the API runs Stryker's
TypeScript checker. A mutant that produces TypeScript compile errors counts
as **killed**. The checker rejected 573 mutants before they reached Jest —
free wins that the web app does not get because its Vitest pipeline does not
ship the same checker. The 75.03% score on API is computed only over mutants
that _survived the checker_; without the checker the score would look
optically lower but with the same number of real survivors.

---

## apps/api — top 5 hot spots (by surviving mutants)

| Rank | File                                     | Survived | Score   | Notes                                              |
| ---- | ---------------------------------------- | -------- | ------- | -------------------------------------------------- |
| 1    | `account/account.service.ts`             | 24       | 60.00 % | DTO/sanitization paths, audit-log side effects     |
| 1    | `auth/auth.config.ts`                    | 24       | 63.08 % | Cookie/CORS defaults — security-critical           |
| 3    | `notifications/notifications.gateway.ts` | 19       | 73.24 % | WebSocket lifecycle, ack/error frames              |
| 4    | `invitations/invitations.service.ts`     | 16       | 44.83 % | Token expiry, accept/decline transitions           |
| 4    | `auth/mailpit-email.provider.ts`         | 16       | 74.60 % | SMTP transport (dev) — assertions on header values |
| 6    | `health/health.controller.ts`            | 15       | 53.13 % | Readiness/liveness payload shape                   |
| 7    | `auth/resend-email.provider.ts`          | 13       | 77.97 % | Production email path                              |
| 8    | `auth/tenant-mfa-policy.guard.ts`        | 12       | 80.33 % | Per-tenant MFA enforcement                         |
| 9    | `config/env.schema.ts`                   | 8        | 85.71 % | Zod boundary — string vs URL parsing               |
| 9    | `auth/prisma-user.repository.ts`         | 8        | 87.69 % | Tenant scoping, soft-delete filters                |
| 9    | `auth/auth-exception.filter.ts`          | 8        | 63.64 % | Error code mapping                                 |

Already at 100% (no Phase 1 work needed):

- `account/account.controller.ts`, `audit/audit.service.ts`,
  `auth/prisma-platform-user.repository.ts`,
  `platform/platform.controller.ts`, `projects/projects.controller.ts`,
  `redis/redis.provider.ts`, `users/users.controller.ts`.

---

## apps/web — top 5 hot spots (by surviving mutants)

| Rank | File                                              | Survived | Score   | Notes                                          |
| ---- | ------------------------------------------------- | -------- | ------- | ---------------------------------------------- |
| 1    | `components/dashboard/mfa-disable-card.tsx`       | 51       | 62.77 % | Form state machine, OTP flow                   |
| 2    | `components/auth/otp-input.tsx`                   | 34       | 64.21 % | Controlled-input edge cases (paste, backspace) |
| 2    | `components/ui/dropdown-menu.tsx`                 | 34       | 2.78 %  | Radix wrapper — see note below                 |
| 4    | `components/platform/platform-users-table.tsx`    | 29       | 66.67 % | Action menu, role badges                       |
| 5    | `components/auth/tenant-switcher.tsx`             | 24       | 62.50 % | Cookie write + redirect                        |
| 6    | `components/dashboard/team-table.tsx`             | 20       | 64.29 % | Pagination, sort                               |
| 6    | `components/platform/platform-mfa-setup-card.tsx` | 20       | 68.25 % | Setup flow mirror of dashboard card            |
| 8    | `lib/auth-client.ts`                              | 17       | 89.63 % | Bearer-token plumbing, JSON parsing            |
| 8    | `components/dashboard/mfa-setup-card.tsx`         | 18       | 71.43 % | MFA setup happy path                           |
| 10   | `lib/ws-client.ts`                                | 23       | 78.70 % | Reconnect backoff, frame parsing               |

Already at 100% (no Phase 1 work needed):

- `components/ui/badge.tsx`, `button.tsx`, `recovery-codes-modal.tsx`.
- `lib/schemas/auth.ts`, `auth-client.account.ts`, `auth-client.audit.ts`,
  `auth-client.mfa.ts`, `auth-client.notifications.ts`, `auth-errors.ts`,
  `qrcode.ts`, `require-auth.ts`, `utils.ts`.

### Note on `components/ui/*`

The `components/ui/` folder is at **19.86%** as a whole because shadcn/ui
wrappers are intentionally thin: they re-export Radix primitives with
Tailwind classNames. The existing unit tests assert on the contract
(roles, aria attributes, className composition) but most mutants land in
literal `className` strings — every `'foo'` → `""` survives because the
visual styling isn't asserted on. Phase 1 strategy for these:

- Where the wrapper has **behaviour** (variant logic, ref forwarding,
  custom keyboard handling) → strengthen the test.
- Where the wrapper is **purely structural** (e.g. `tabs.tsx`,
  `tooltip.tsx`, `sonner.tsx`, `table.tsx`, `dialog.tsx`) and any
  className mutation is an equivalent or purely visual change →
  either add a single `// Stryker disable next-line StringLiteral`
  with a colon-reason, **or** exclude the file from `mutate` via an
  ADR.

Do **not** make this call file-by-file in Phase 0 — Phase 1 is the
triage phase.

---

## Reports

- **HTML report (API)**: `apps/api/reports/mutation/api.html`
- **HTML report (Web)**: `apps/web/reports/mutation/web.html`
- **Full run log (API)**: `apps/api/reports/mutation-api-run.log`
- **Full run log (Web)**: `apps/web/reports/mutation-web-run.log`

The HTML reports are excluded from git via `.gitignore` — open them
locally after running `pnpm mutation:<app>`.

---

## Configuration warnings observed

Stryker emitted two harmless warnings on each run. They do not block the
suite and are kept in the config for safety; revisit during Phase 1 if
they become noisy.

```
WARN ProjectReader  Glob pattern "!**/index.ts" did not exclude any files.
WARN ProjectReader  Glob pattern "!src/**/*.d.ts" did not exclude any files.
WARN ProjectReader  Glob pattern "!src/**/index.ts" did not exclude any files.
```

These are belt-and-suspenders excludes: there are no `index.ts` or
`.d.ts` files in the mutate scope today, but new ones could appear, and
keeping the negation guards against accidental inclusion later.

---

## Phase 1 entry criteria

Per [`IMPLEMENTATION_PLAN.md` §3](./IMPLEMENTATION_PLAN.md), Phase 0
exits successfully when:

- [x] Stryker runs end-to-end on both workspaces.
- [x] 100% line/branch/function/statement coverage maintained after the
      Stryker wiring (verified by `pnpm test:cov`).
- [x] No suppression comments introduced.
- [x] Baseline scores recorded (this document).
- [x] `docs/guidelines/mutation-testing-guidelines.md` published.

Phase 1 starts with the top hot spots above. Suggested PR sizing
(one feature folder per PR):

1. `auth.config.ts` + `auth-exception.filter.ts` — security-critical, fast wins.
2. `account.service.ts` — audit-log side effects need stronger assertions.
3. `invitations.service.ts` — heaviest %-wise gap; transition logic.
4. `notifications.gateway.ts` — WebSocket framing & ack handling.
5. `components/dashboard/mfa-disable-card.tsx` + `components/auth/otp-input.tsx` — coordinated MFA UI hardening.
6. `lib/ws-client.ts` — reconnect / backoff assertions.

Track progress in [`HISTORY.md`](./HISTORY.md) after each PR.
