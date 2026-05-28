# CLAUDE.md — nest-auth-example

Quick rules for Claude Code and any AI coding agent. Read before every task.

Full spec in [AGENTS.md](AGENTS.md). Domain-specific rules in [docs/guidelines/](docs/guidelines/) — load **on demand**, never all at once.

---

## What this project is

Reference application for [`@bymax-one/nest-auth`](https://github.com/bymax-one/nest-auth). Demonstrates, end-to-end, every feature the library ships: JWT refresh rotation, MFA (TOTP + recovery codes), OAuth (Google), multi-tenancy, platform admin, invitations, session management, brute-force protection, WebSocket auth.

Full context: [docs/OVERVIEW.md](docs/OVERVIEW.md). Build roadmap: [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md).

---

## Stack (headline)

- **Monorepo**: pnpm workspaces, Node ≥ 24, TypeScript 6 strict
- **`apps/api`** — NestJS 11 on Express 5, Prisma 7 + PostgreSQL 18, `ioredis` + Redis 7, Pino, class-validator, Zod 4, Jest 30 + supertest
- **`apps/web`** — Next.js 16 App Router, React 19, Tailwind CSS 4, shadcn/ui, React Hook Form + Zod, Vitest 4 + Playwright 1
- **Library** — `@bymax-one/nest-auth@^1.0.2` from npm (use `pnpm link` ad hoc for sibling lib development)
- **Infra** — Docker Compose v2: PostgreSQL, Redis, Mailpit (dev); Resend (prod reference)
- **Tooling** — ESLint 10 flat, Prettier 3, Husky 9, lint-staged, commitlint (conventional commits)

---

## Non-negotiables

### TypeScript strict, zero `any`

`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `verbatimModuleSyntax: true`. Never `// @ts-ignore`, `// @ts-expect-error`, `as any`, or `// eslint-disable`. Fix the root cause. See [docs/guidelines/typescript-guidelines.md](docs/guidelines/typescript-guidelines.md).

### English comments only, documentation mandatory

Every code comment and JSDoc in English. User-facing strings stay out of code (no hardcoded UI text in `apps/web`). Every non-trivial file starts with a JSDoc header; every exported function, hook, component, service, DTO has a JSDoc block; every test `it` has a scenario comment. See [docs/guidelines/coding-style.md § Code documentation](docs/guidelines/coding-style.md#code-documentation--mandatory).

### Library-faithful

`@bymax-one/nest-auth` exports are used as-shipped — no reshaping, no re-implementing of guards, decorators, DTOs, error codes. See [docs/guidelines/nest-auth-guidelines.md](docs/guidelines/nest-auth-guidelines.md).

### Security-first defaults

Cookies HttpOnly, `secure` derived from `NODE_ENV`, `SameSite=Lax`. CORS allowlisted to `WEB_ORIGIN`. Every request body/param goes through a DTO or Zod schema. Env vars validated at boot; the app refuses to start on invalid config. See [docs/guidelines/security-privacy-guidelines.md](docs/guidelines/security-privacy-guidelines.md) and [docs/guidelines/environment-guidelines.md](docs/guidelines/environment-guidelines.md).

### Multi-tenant by construction

`tenantId` on every user-facing row; every query scopes by it. `tenantIdResolver` reads only from the `X-Tenant-Id` header. Cross-tenant data access is a bug. See [docs/guidelines/nest-auth-guidelines.md](docs/guidelines/nest-auth-guidelines.md).

### No direct `process.env.*`

Backend reads go through `ConfigService<Env, true>`; frontend reads through `lib/env.ts`. Typos become compile errors, not silent `undefined`. See [docs/guidelines/environment-guidelines.md](docs/guidelines/environment-guidelines.md).

### No secrets in logs

Pino `redact` paths cover the obvious keys. Never log request bodies, tokens, OTPs, `passwordHash`. See [docs/guidelines/logging-guidelines.md](docs/guidelines/logging-guidelines.md).

### Never commit or push

AI agents **never** run `git commit` or `git push`. The user reviews files and commits manually. Prepare commands as suggestions. See [docs/guidelines/git-workflow.md](docs/guidelines/git-workflow.md).

---

## Before ANY task — in this order

1. Skim this file.
2. Open [AGENTS.md](AGENTS.md) → "Critical rules" + "Common pitfalls".
3. Read **only the guidelines** needed for the task (see map below).
4. Read the relevant section of [docs/OVERVIEW.md](docs/OVERVIEW.md) if the task touches a specific feature in the Feature Coverage Matrix.
5. Before coding, list:
   - Files to be created/modified.
   - Guidelines consulted.
   - Risks and edge cases.

Never open every guideline — load on demand. The table below maps task → guideline.

---

## On-demand guidelines map

| Task                                                                           | Guideline                                                                        |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| NestJS module, controller, service, guard, pipe                                | [nestjs-guidelines.md](docs/guidelines/nestjs-guidelines.md)                     |
| Prisma schema, query, migration, seed                                          | [prisma-guidelines.md](docs/guidelines/prisma-guidelines.md)                     |
| PostgreSQL index, raw SQL, perf                                                | [postgres-guidelines.md](docs/guidelines/postgres-guidelines.md)                 |
| Redis key design, TTL, pub/sub                                                 | [redis-guidelines.md](docs/guidelines/redis-guidelines.md)                       |
| Next.js App Router, route handler, middleware                                  | [nextjs-guidelines.md](docs/guidelines/nextjs-guidelines.md)                     |
| React component, hook, context                                                 | [react-guidelines.md](docs/guidelines/react-guidelines.md)                       |
| Styling, token, shadcn/ui                                                      | [tailwind-guidelines.md](docs/guidelines/tailwind-guidelines.md)                 |
| Types, generics, tsconfig                                                      | [typescript-guidelines.md](docs/guidelines/typescript-guidelines.md)             |
| Form with React Hook Form + Zod                                                | [forms-guidelines.md](docs/guidelines/forms-guidelines.md)                       |
| DTO / env / boundary validation                                                | [validation-guidelines.md](docs/guidelines/validation-guidelines.md)             |
| Logging, Pino configuration                                                    | [logging-guidelines.md](docs/guidelines/logging-guidelines.md)                   |
| Email template or provider swap                                                | [email-guidelines.md](docs/guidelines/email-guidelines.md)                       |
| `@bymax-one/nest-auth` wiring                                                  | [nest-auth-guidelines.md](docs/guidelines/nest-auth-guidelines.md)               |
| Any test — unit, integration, e2e, Playwright                                  | [testing-guidelines.md](docs/guidelines/testing-guidelines.md)                   |
| Compose file, Docker config                                                    | [docker-guidelines.md](docs/guidelines/docker-guidelines.md)                     |
| New workspace, root script, pnpm filter                                        | [monorepo-guidelines.md](docs/guidelines/monorepo-guidelines.md)                 |
| Env var, `.env.example`                                                        | [environment-guidelines.md](docs/guidelines/environment-guidelines.md)           |
| Audit row, `/health`, metric                                                   | [observability-guidelines.md](docs/guidelines/observability-guidelines.md)       |
| Auth, cookies, CORS, secrets                                                   | [security-privacy-guidelines.md](docs/guidelines/security-privacy-guidelines.md) |
| ESLint / Prettier / hook change                                                | [lint-format-guidelines.md](docs/guidelines/lint-format-guidelines.md)           |
| Codebase style + code documentation policy                                     | [coding-style.md](docs/guidelines/coding-style.md)                               |
| Branch, commit, PR, revert                                                     | [git-workflow.md](docs/guidelines/git-workflow.md)                               |
| Approving a PR                                                                 | [pr-review.md](docs/guidelines/pr-review.md)                                     |
| Handing off work to another agent                                              | [agent-handoff.md](docs/guidelines/agent-handoff.md)                             |
| Mutation testing — Stryker config, killing mutants, `// Stryker disable` rules | [mutation-testing-guidelines.md](docs/guidelines/mutation-testing-guidelines.md) |

---

## Verification before finishing

```bash
pnpm typecheck      # TS must compile — 0 errors
pnpm lint           # ESLint must pass — 0 errors or suppressions
pnpm format:check   # Prettier must be clean
pnpm test           # unit + integration
```

For features that touch the wire:

```bash
pnpm infra:up                                  # postgres + redis + mailpit
pnpm --filter @nest-auth-example/api dev       # boot the API
pnpm --filter @nest-auth-example/web dev       # boot the web app
# Exercise the flow end-to-end in a browser / curl.
```

For changes that touch core business logic in `apps/api/src/` (services, guards, controllers, providers) or `apps/web/lib/` / `apps/web/components/`, also run the mutation suite for the affected workspace before opening the PR. 100% line coverage proves the lines run; mutation score proves the assertions catch behaviour changes.

```bash
pnpm mutation:api                              # full mutation run for the API
pnpm mutation:web                              # full mutation run for the web
pnpm mutation:incremental:api                  # faster iteration during the kill loop
```

**Both workspaces are at 100.00 % mutation score** (Phase 1 complete
2026-05-28 — 2120 mutants killed, zero behavioural survivors). CI
enforces this on every PR via `.github/workflows/mutation.yml` with
`thresholds.break = 100` in both `stryker.config.json` files —
**a single surviving mutant blocks the merge**. The PR workflow uses
Stryker's incremental cache (typically <2 min per workspace) and a
weekly `mutation-nightly.yml` does a full cold run as drift safety net.

See [docs/guidelines/mutation-testing-guidelines.md](docs/guidelines/mutation-testing-guidelines.md) and the implementation plan in [docs/stryker/IMPLEMENTATION_PLAN.md](docs/stryker/IMPLEMENTATION_PLAN.md).

**Hard-won Stryker rules** — read [mutation-testing-guidelines.md § Disable-directive placement](docs/guidelines/mutation-testing-guidelines.md#disable-directive-placement--stryker-ast-quirks) BEFORE writing any `// Stryker disable` comment. Three rules that bite hardest:

1. `Stryker disable next-line` only suppresses mutants whose AST node **starts on the next line**. Multi-line `else if`, chained JSX `&&` guards, and `useEffect(() => {…}, [deps])` where the deps live on the closing line all attribute mutants to the parent statement's start. Extract conditions into named locals (`const isCounterVisible = …`) and deps arrays into module-level constants (`const EMPTY_EFFECT_DEPS = []`) so the directive lands.
2. JSX comments `{/* Stryker disable … */}` are **not parsed**. Use plain `//` JS comments, which means refactoring so the directive lives in a JS context (extract ternary, className composition, etc.).
3. `BlockStatement` mutants on `try/finally` resist `next-line` AND block-form disables when the directive sits in the surrounding catch arm. Prefer a real kill test that asserts on the post-resolve UI state (button re-enabled, label restored, "Loading…" gone) over chasing a directive that won't land.

When a mutant is genuinely equivalent, the disable comment MUST name the mutator(s) and carry a colon-prefixed rationale that points at the test / invariant that protects against the underlying defect.

Manual sweep on changed files:

- [ ] No `console.log` / `console.warn` / `console.error` — use the logger.
- [ ] No `any`, no `// @ts-ignore`, no `// eslint-disable`.
- [ ] Comments in English only.
- [ ] File-header JSDoc on every new non-trivial file.
- [ ] JSDoc on every new exported function, hook, component, service, DTO.
- [ ] Every new test `it` has a block comment describing the scenario and rule it protects.
- [ ] No hardcoded secrets, tokens, URLs (outside `.env`, `@theme`, etc.).
- [ ] No cross-feature imports.
- [ ] No reshaping of `@bymax-one/nest-auth` library objects.
- [ ] `tenantId` scoping preserved on every new query.
- [ ] New external deps documented in the right guideline.

---

## Git

Never commit or push without explicit user approval. Prepare commands for the user to run. See [docs/guidelines/git-workflow.md](docs/guidelines/git-workflow.md).

Conventional Commits grammar (`feat(scope): …`, `fix(scope): …`).

---

## If a rule conflicts with the task

Security and privacy win. Library fidelity wins over ergonomics. A rule you think is wrong → raise it in the PR or open an ADR under `docs/decisions/`. Don't silently work around it.

---

**When in doubt, read the specific guideline before you write code.**
