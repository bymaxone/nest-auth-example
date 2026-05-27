# Stryker Mutation Testing — Implementation Plan

> **Audience**: AI coding agents (Claude Code, Cursor, etc.) and human contributors.
> **Status**: Draft, awaiting user approval. Once approved, this becomes the executable
> spec for the implementation.
> **Owner**: Maximiliano Salvatti (`msalvatti@gmail.com`).
> **Last updated**: 2026-05-26.

---

## 0. Executive summary

Add **[Stryker Mutator](https://stryker-mutator.io) v9** to the `nest-auth-example`
monorepo so that we can measure and incrementally improve **mutation score** in both
workspaces:

- `apps/api` — NestJS 11 + Jest 30 (uses `ts-jest`, ESM via
  `--experimental-vm-modules`, custom `jest-ts-transform.cjs` for decorator-metadata
  branch coverage).
- `apps/web` — Next.js 16 App Router + React 19 + Vitest 4 (jsdom).

**Final target**: as close to 100% mutation score as feasible without weakening tests
or hiding mutants behind broad disables.

**Why mutation testing?** Line/branch coverage at 100% (which both apps already have)
proves every line _executed_ during tests, but **does not prove the assertions
actually catch behaviour changes**. A test that calls a function without asserting
its return value still counts toward 100% coverage but kills zero mutants. Stryker
mutates the source (`+` → `-`, `<` → `<=`, `true` → `false`, removes `return`,
etc.), reruns the tests, and reports how many mutants the suite **kills** (test
fails) vs. **survives** (test still passes — a real gap). Mutation score is the
honest signal for test _strength_, where coverage is the signal for test _reach_.

**Non-goals of this plan**:

- Does **not** replace Playwright e2e tests for Next.js `app/` routes.
- Does **not** introduce Stryker Dashboard (`dashboard.stryker-mutator.io`) — that
  is an opt-in, separate ADR.
- Does **not** unify the two test runners (Jest vs. Vitest) — both stay.

---

## 1. Context

### 1.1 Current testing state

| Workspace  | Runner                      | Specs                  | Coverage                           | Coverage gate                                                          |
| ---------- | --------------------------- | ---------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| `apps/api` | Jest 30 + ts-jest (ESM)     | 31 `.spec.ts` files    | 100%                               | `coverageThreshold` global 100% on lines/branches/functions/statements |
| `apps/web` | Vitest 4 + jsdom + React 19 | 50 `.test.ts(x)` files | 100% on `lib/**` + `components/**` | `coverage.thresholds` global 100%                                      |

Both apps currently pass `pnpm test:cov` with 100% across all four metrics.
The web app **excludes** `app/**` (Next.js pages/layouts/route handlers) from
coverage because those use `cookies()`/`redirect()`/`headers()` and only work
under a running server — they are covered by Playwright in `apps/web/e2e/`.

### 1.2 Sibling reference: `@bymax-one/nest-auth`

The sibling library at `/Users/maximiliano/Documents/MyApps/nest-auth` already
runs Stryker successfully. Key facts from its setup that this plan mirrors:

- `@stryker-mutator/core@^9` + `@stryker-mutator/jest-runner@^9` +
  `@stryker-mutator/typescript-checker@^9`.
- `coverageAnalysis: "perTest"` (every mutant runs only the tests that actually
  cover it — typically 5–20× speedup).
- Wrapper config `jest.stryker.config.ts` extends the base `jest.config.ts` and
  swaps `testEnvironment` to Stryker's instrumented Node env.
- Thresholds `{ high: 99, low: 95, break: 95 }`.
- `disableTypeChecks: "src/**/*.{ts,tsx}"` plus
  `typescriptChecker: { prioritizePerformanceOverAccuracy: true }`.
- HTML report under `reports/mutation/mutation.html`.
- Scripts: `mutation`, `mutation:incremental`, `mutation:dry-run`.

**The big architectural difference** between the sibling and this repo:
the sibling has **one** test runner; this repo has **two**. So we install
Stryker per workspace and pick the right runner for each.

### 1.3 Why per-workspace configs (not a single root config)

- Each workspace has a different `node_modules`, different ts-config, different
  test runner. A root-level Stryker config would need branching logic per app
  and would not benefit from each workspace's existing alias maps.
- pnpm filter (`pnpm --filter ...`) handles the fan-out cleanly.
- The sibling proved a single config per package is enough.
- The HTML report path can be relative to each workspace, no path juggling.

---

## 2. Architectural decisions

| Decision           | Choice                                                                 | Rationale                                                                            |
| ------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Scope              | **Two configs**: one per workspace                                     | Different runners, different deps, different mutate patterns                         |
| Stryker major      | `^9`                                                                   | Mirrors sibling; latest stable as of 2026-05                                         |
| API runner plugin  | `@stryker-mutator/jest-runner` + `@stryker-mutator/typescript-checker` | Sibling-proven; TS checker rejects type-error mutants fast                           |
| Web runner plugin  | `@stryker-mutator/vitest-runner`                                       | Official first-class Vitest support; no checker (Vitest config already strict)       |
| `coverageAnalysis` | `"perTest"` (both apps)                                                | Maps mutant → covering tests; 5–20× speedup                                          |
| `ignoreStatic`     | `true` (both apps)                                                     | Skips mutants that only execute during module load (NestJS DI metadata, Zod schemas) |
| `incremental`      | `false` default, opt-in via `mutation:incremental` script              | Default-off so CI sees full picture; on for local dev iteration                      |
| Initial thresholds | `{ high: 95, low: 85, break: 80 }`                                     | Realistic baseline; raised to `99/95/95` in Phase 3                                  |
| Reports            | `progress`, `clear-text`, `html` → `reports/mutation/<app>.html`       | Mirrors sibling layout                                                               |
| Dashboard          | **Excluded from this plan**                                            | Requires token + decision on org/repo URL; separate ADR                              |
| CI                 | Separate `mutation.yml` workflow, label-triggered until Phase 2        | Doesn't block PRs until baseline is real                                             |
| Workspace topology | Stryker is a **devDep of each app**, not root                          | Each `pnpm --filter` resolves its own binary                                         |

---

## 3. Phasing strategy

Mutation score is **not** something you flip on overnight. Even with 100%
coverage, the initial score on a fresh project is typically 70–85%. Trying to
gate CI on 95+ on day one would either (a) block every PR for weeks, or
(b) push agents to write low-value tests just to kill noise mutants. So the
plan is staged.

### Phase 0 — Baseline (1 PR, ~3h)

**Goal**: Prove Stryker runs on both workspaces end-to-end. Establish the
numerical baseline. **Do not** enforce any threshold.

**Tasks**:

1. Install deps in each workspace.
2. Create `stryker.config.json` in each workspace (full contents in §4).
3. Create `apps/api/jest.stryker.config.ts`.
4. Add scripts to root and workspace `package.json` files.
5. Update `.gitignore` to exclude `.stryker-tmp/`, `reports/mutation/`,
   `reports/stryker-incremental.json`.
6. Update `eslint.config.mjs` to ignore the same paths.
7. Run `pnpm mutation:api` and `pnpm mutation:web` locally.
8. Record the baseline mutation score for each app in
   `docs/stryker/BASELINE.md` (created at end of Phase 0).
9. Write `docs/guidelines/mutation-testing-guidelines.md`.
10. Update `CLAUDE.md` to add the new guideline to the on-demand map.

**Exit gate**:

- [ ] `pnpm test` still 100% coverage in both apps.
- [ ] `pnpm typecheck` 0 errors.
- [ ] `pnpm lint` 0 errors.
- [ ] `pnpm mutation:api` finishes and produces `apps/api/reports/mutation/api.html`.
- [ ] `pnpm mutation:web` finishes and produces `apps/web/reports/mutation/web.html`.
- [ ] Baseline scores recorded.

**Threshold during Phase 0**: `{ high: 95, low: 85, break: null }`.
The `break: null` is critical — we explicitly do NOT want CI to fail until
we know what the actual score is.

### Phase 1 — Hardening existing tests (iterative, 10–25h spread across multiple PRs)

**Goal**: Kill surviving mutants by strengthening assertions, not by hiding
them. Priority order: services → guards → controllers → providers/config →
UI components.

**Process per file**:

1. Open the HTML report and locate the file.
2. List its surviving mutants.
3. For each surviving mutant, classify it:
   - **Real gap** → add a unit test that asserts on the exact behaviour the
     mutant changes. Prefer asserting on the return value, the thrown error
     code, the audit-log row, the cookie, or the side-effect — not on
     "function was called".
   - **Equivalent mutant** → the mutated code is semantically identical to
     the original. Add a `// Stryker disable next-line <Mutator>: <reason>`
     comment. The reason is mandatory and must be specific.
   - **Wontfix** (rare) → log it under `excludedMutations` only with an
     ADR in `docs/decisions/`.
4. Re-run `pnpm mutation:api -- --mutate <file>` (or equivalent for web) to
   confirm the score moved.
5. Verify line/branch/function/statement coverage remains 100% after the
   added tests.

**PR sizing**: One PR per feature folder (auth, account, projects, tenants,
platform, audit, …) keeps reviews tractable. Each PR's description must
include before/after mutation score for the touched files.

**Exit gate for Phase 1**: Both apps reach ≥ 90% mutation score globally.

### Phase 2 — Raise threshold and wire CI (1 PR, ~1h)

**Goal**: Make regression impossible.

**Tasks**:

1. Change `thresholds` in both `stryker.config.json` to
   `{ high: 95, low: 90, break: 90 }`.
2. Create `.github/workflows/mutation.yml` (full contents in §7).
3. Make the workflow `required` for PRs targeting `main`.

**Exit gate**:

- [ ] CI mutation job green on both apps.
- [ ] PR that intentionally weakens an assertion fails the mutation job
      (smoke test).

### Phase 3 — Push toward parity with the sibling (iterative, 10–20h)

**Goal**: Reach `{ high: 99, low: 95, break: 95 }` to match
`@bymax-one/nest-auth`.

**Tasks**:

1. Identify files still under 95% and repeat the Phase 1 process.
2. Once both apps clear 95% globally, raise thresholds.
3. Schedule a quarterly re-measurement cadence — record drift in
   `docs/stryker/HISTORY.md`.

---

## 4. Files to create/modify (exact paths and contents)

### 4.1 `apps/api/stryker.config.json` (CREATE)

```jsonc
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "packageManager": "pnpm",
  "plugins": ["@stryker-mutator/jest-runner", "@stryker-mutator/typescript-checker"],
  "testRunner": "jest",
  "coverageAnalysis": "perTest",
  "jest": {
    "projectType": "custom",
    "configFile": "jest.stryker.config.ts",
    "enableFindRelatedTests": true,
  },
  "testRunnerNodeArgs": ["--experimental-vm-modules"],
  "checkers": ["typescript"],
  "tsconfigFile": "tsconfig.spec.json",
  "typescriptChecker": {
    "prioritizePerformanceOverAccuracy": true,
  },
  "disableTypeChecks": "src/**/*.{ts,tsx}",
  "ignoreStatic": true,
  "mutate": [
    "src/**/*.ts",
    "!src/**/*.spec.ts",
    "!src/**/*.module.ts",
    "!src/main.ts",
    "!src/**/*.dto.ts",
    "!src/**/*.d.ts",
    "!src/**/index.ts",
  ],
  "ignorePatterns": ["dist", "coverage", "test", ".stryker-tmp"],
  "thresholds": { "high": 95, "low": 85, "break": null },
  "concurrency": 4,
  "timeoutMS": 30000,
  "incremental": false,
  "incrementalFile": "reports/stryker-incremental.json",
  "reporters": ["progress", "clear-text", "html"],
  "htmlReporter": { "fileName": "reports/mutation/api.html" },
  "tempDirName": ".stryker-tmp",
  "cleanTempDir": true,
}
```

**Field-by-field rationale**:

| Field                                                       | Why                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packageManager: "pnpm"`                                    | Stryker needs to know which CLI to call when copying the sandbox                                                                                                                                                                                          |
| `plugins`                                                   | Explicit list; Stryker auto-discovery is slower and silently falls back                                                                                                                                                                                   |
| `testRunner: "jest"`                                        | Drives `@stryker-mutator/jest-runner`                                                                                                                                                                                                                     |
| `coverageAnalysis: "perTest"`                               | Map mutant → covering tests. Required for `ignoreStatic`                                                                                                                                                                                                  |
| `jest.projectType: "custom"`                                | Tells the runner to use our config file, not its NestJS auto-detect                                                                                                                                                                                       |
| `jest.configFile`                                           | Points to the Stryker-only Jest wrapper                                                                                                                                                                                                                   |
| `jest.enableFindRelatedTests: true`                         | Only runs tests Jest considers related to the mutated file (further filter on top of `perTest`)                                                                                                                                                           |
| `testRunnerNodeArgs: ["--experimental-vm-modules"]`         | **Critical**: matches `pnpm test`; without it, ESM imports throw at load time                                                                                                                                                                             |
| `checkers: ["typescript"]`                                  | Reject mutants that would not even compile (~free wins)                                                                                                                                                                                                   |
| `disableTypeChecks: "src/**/*.{ts,tsx}"`                    | Stops the checker from doing full project type-check on every mutant — relies on top-level `pnpm typecheck` for global safety                                                                                                                             |
| `typescriptChecker.prioritizePerformanceOverAccuracy: true` | Trade rare false negatives for ~3× speed                                                                                                                                                                                                                  |
| `ignoreStatic: true`                                        | NestJS DI metadata, schema definitions, etc. run at import time and would otherwise generate many noise mutants                                                                                                                                           |
| `mutate` exclusions                                         | Same shape as `collectCoverageFrom` in `jest.config.ts`. Modules, DTOs, `main.ts`, and barrel `index.ts` are skipped from coverage and have no mutation value (Modules are pure DI metadata; DTOs are class-validator decorators; barrels are re-exports) |
| `ignorePatterns`                                            | Avoid copying multi-GB folders into the sandbox                                                                                                                                                                                                           |
| `thresholds.break: null`                                    | Phase 0 only — flipped to 80, then 90, then 95 in later phases                                                                                                                                                                                            |
| `concurrency: 4`                                            | Matches sibling; tune up locally if you have more cores                                                                                                                                                                                                   |
| `timeoutMS: 30000`                                          | Some tests hit Redis/Prisma test containers via supertest; give them room                                                                                                                                                                                 |
| `incrementalFile` under `reports/`                          | Keeps the file out of the source tree but inside the workspace                                                                                                                                                                                            |
| `htmlReporter.fileName`                                     | Per-app subpath under `reports/mutation/`                                                                                                                                                                                                                 |

### 4.2 `apps/api/jest.stryker.config.ts` (CREATE)

```ts
/**
 * Stryker-only Jest configuration for @nest-auth-example/api.
 *
 * Layer: tooling.
 *
 * Wraps `jest.config.ts` and swaps `testEnvironment` for Stryker's
 * instrumented Node environment so `coverageAnalysis: "perTest"` can
 * map every mutant to the exact tests covering it. The base config
 * is left untouched: a regular `pnpm test` never touches Stryker.
 */
import type { Config } from 'jest';

import base from './jest.config';

const config: Config = {
  ...base,
  testEnvironment: '@stryker-mutator/jest-runner/jest-env/node',
};

export default config;
```

**Note**: this file imports the base config without modification. If the
base config ever needs to be split between "normal" and "stryker" modes
(e.g. different reporters), do it via composition here — do **not** edit
the base config to add Stryker awareness.

### 4.3 `apps/web/stryker.config.json` (CREATE)

```jsonc
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "packageManager": "pnpm",
  "plugins": ["@stryker-mutator/vitest-runner"],
  "testRunner": "vitest",
  "vitest": {
    "configFile": "vitest.config.ts",
  },
  "coverageAnalysis": "perTest",
  "ignoreStatic": true,
  "mutate": [
    "lib/**/*.ts",
    "components/**/*.tsx",
    "!**/*.test.ts",
    "!**/*.test.tsx",
    "!**/*.d.ts",
    "!**/index.ts",
    "!**/*.config.ts",
  ],
  "ignorePatterns": [".next", "coverage", "e2e", "playwright-report", "app", ".stryker-tmp"],
  "thresholds": { "high": 95, "low": 85, "break": null },
  "concurrency": 4,
  "timeoutMS": 30000,
  "incremental": false,
  "incrementalFile": "reports/stryker-incremental.json",
  "reporters": ["progress", "clear-text", "html"],
  "htmlReporter": { "fileName": "reports/mutation/web.html" },
  "tempDirName": ".stryker-tmp",
  "cleanTempDir": true,
}
```

**Field-by-field rationale (only the deltas from the API config)**:

| Field                                     | Why                                                                                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugins` only has `vitest-runner`        | No `typescript-checker` for Vitest workspaces; the Vitest pipeline already runs the TS pipeline via Vite                                                                              |
| `testRunner: "vitest"`                    | Drives `@stryker-mutator/vitest-runner`                                                                                                                                               |
| `vitest.configFile: "vitest.config.ts"`   | Reuses the existing config — same `plugins: [react()]`, same `jsdom`, same alias `@`                                                                                                  |
| `mutate` scope                            | Only `lib/**` (pure modules) and `components/**` (testable React). **No `app/**`\*\* because Next.js pages/layouts/route handlers require a Next server and are covered by Playwright |
| `ignorePatterns` includes `app` and `e2e` | Belt-and-suspenders: never copy them into the sandbox                                                                                                                                 |

### 4.4 Root `package.json` scripts (MODIFY)

Add the following entries to the `"scripts"` section, alongside the existing
`"test:cov:api"` / `"test:cov:web"` pattern:

```jsonc
"mutation": "pnpm -r --if-present run mutation",
"mutation:api": "pnpm --filter @nest-auth-example/api run mutation",
"mutation:web": "pnpm --filter @nest-auth-example/web run mutation",
"mutation:incremental": "pnpm -r --if-present run mutation:incremental",
"mutation:incremental:api": "pnpm --filter @nest-auth-example/api run mutation:incremental",
"mutation:incremental:web": "pnpm --filter @nest-auth-example/web run mutation:incremental",
"mutation:dry-run": "pnpm -r --if-present run mutation:dry-run"
```

### 4.5 `apps/api/package.json` (MODIFY)

Add to `"scripts"`:

```jsonc
"mutation": "stryker run",
"mutation:incremental": "stryker run --incremental",
"mutation:dry-run": "stryker run --dryRunOnly"
```

Add to `"devDependencies"`:

```jsonc
"@stryker-mutator/core": "^9",
"@stryker-mutator/jest-runner": "^9",
"@stryker-mutator/typescript-checker": "^9"
```

### 4.6 `apps/web/package.json` (MODIFY)

Add to `"scripts"`:

```jsonc
"mutation": "stryker run",
"mutation:incremental": "stryker run --incremental",
"mutation:dry-run": "stryker run --dryRunOnly"
```

Add to `"devDependencies"`:

```jsonc
"@stryker-mutator/core": "^9",
"@stryker-mutator/vitest-runner": "^9"
```

**Why no `typescript-checker` for web?** The Vitest runner already executes
TS via Vite's transform pipeline. Adding the checker on top would duplicate
work and slow each mutant by 200–500ms. Global type safety is enforced by
`pnpm typecheck` in CI, not per-mutant.

### 4.7 `.gitignore` (MODIFY)

Append:

```gitignore
# Stryker mutation testing
.stryker-tmp/
**/.stryker-tmp/
reports/mutation/
**/reports/mutation/
reports/stryker-incremental.json
**/reports/stryker-incremental.json
stryker.log
**/stryker.log
```

### 4.8 `eslint.config.mjs` (MODIFY)

In the top-level `ignores` array:

```js
{ ignores: [
  '**/dist',
  '**/.next',
  '**/coverage',
  '**/node_modules',
  '**/*.d.ts',
  // Mutation testing artefacts
  '**/.stryker-tmp',
  '**/reports/mutation',
] },
```

### 4.9 `CLAUDE.md` (MODIFY)

In the **On-demand guidelines map** table, add:

```md
| Mutation testing — running Stryker, killing surviving mutants, disable comments | [mutation-testing-guidelines.md](docs/guidelines/mutation-testing-guidelines.md) |
```

In the **Verification before finishing** section, **do not** add `pnpm mutation`
to the default verification list (it is too slow for the standard pre-commit
loop). Add a separate paragraph:

```md
For changes that touch core business logic in `apps/api/src/` or
`apps/web/lib|components/`, also run the mutation suite for the affected
workspace before opening the PR:

\`\`\`bash
pnpm mutation:api # or mutation:web
pnpm mutation:incremental # faster iteration during the kill loop
\`\`\`

See [docs/guidelines/mutation-testing-guidelines.md](docs/guidelines/mutation-testing-guidelines.md).
```

### 4.10 `docs/guidelines/mutation-testing-guidelines.md` (CREATE)

This is the long-lived guideline that AI agents and humans read whenever they
touch mutation work. It is **not** the same document as this plan — this plan
is one-shot, the guideline is permanent. Skeleton:

```md
# Mutation Testing Guidelines

## Purpose

What mutation testing is. Why it complements coverage.

## When to run it

- After any change to `apps/api/src/**/*.ts` (services, guards, controllers).
- After any change to `apps/web/lib/**` or `apps/web/components/**`.
- Not required for `.module.ts`, `.dto.ts`, `app/**` (Next.js pages),
  e2e tests, or pure type files.

## Commands

- `pnpm mutation:api` — full run for the API.
- `pnpm mutation:web` — full run for the web.
- `pnpm mutation:incremental:api` — only re-test mutants affected by
  the working-tree diff. Use during the kill loop.
- `pnpm mutation:dry-run` — verify config without running mutants.

## Reading the HTML report

- Open `apps/<app>/reports/mutation/<app>.html`.
- Filter by `Survived`.
- Click a file to see the exact mutant operator and the source line.

## Classifying a surviving mutant

For each one, decide:

1. **Real gap** → add a unit test that asserts on the exact return value /
   error code / side-effect that the mutant changes.
2. **Equivalent mutant** → semantically identical to the original. Add
   `// Stryker disable next-line <Mutator>: <reason>` with a specific
   reason (e.g. "lower bound is unreachable because length >= 0").
3. **Wontfix** → very rare. Requires an ADR in `docs/decisions/`.

## Disable comments — strict rules

- Always use `next-line`, never file-wide `// Stryker disable all`.
- Always name the mutator (`EqualityOperator`, `BooleanLiteral`,
  `ArithmeticOperator`, etc.) — never `all`.
- Always include a reason after the colon.
- A PR that adds a disable comment without a reason will be rejected by
  /bymax-quality:code-review.

## Common mutators and how to kill them

(Equality, Boolean, Arithmetic, Conditional, String literal, Array,
Object literal, Method expression, Logical operator, Update operator,
…)

## Equivalent mutants — known patterns in this repo

(e.g. `tenantId === undefined` vs `tenantId === null` after Zod parse
where Zod guarantees `undefined`; `>= 0` vs `> -1` on array length, etc.)

## CI integration

Workflow runs on PR with label `run-mutation` or on push to `main`.
See `.github/workflows/mutation.yml`.
```

The full content of the guideline is **created in Phase 0 with the first
PR**, populated with the patterns we hit during the baseline run.

### 4.11 `docs/stryker/BASELINE.md` (CREATE in Phase 0)

After the first successful run, capture:

```md
# Mutation Testing — Baseline (Phase 0)

Recorded on YYYY-MM-DD, commit <sha>.

## apps/api

- Mutation score: XX.X%
- Killed: NNN
- Survived: NNN
- Timed out: NNN
- No coverage: NNN
- Runtime: ~MM minutes (concurrency=4)

## apps/web

- Mutation score: XX.X%
- Killed: NNN
- Survived: NNN
- Timed out: NNN
- No coverage: NNN
- Runtime: ~MM minutes (concurrency=4)

## Hot spots (≥ 5 surviving mutants)

| File | Survived | Top mutator |
| ---- | -------- | ----------- |
| ...  | ...      | ...         |
```

### 4.12 `docs/stryker/HISTORY.md` (CREATE in Phase 1, updated each PR)

```md
# Mutation Score History

| Date       | Commit | API score | Web score | Notes                  |
| ---------- | ------ | --------- | --------- | ---------------------- |
| 2026-MM-DD | abc123 | 82.4%     | 78.9%     | Phase 0 baseline       |
| 2026-MM-DD | def456 | 86.1%     | 81.2%     | Hardened auth services |
```

---

## 5. Concrete dependency installation commands

Phase 0 step 1, in order:

```bash
# API
pnpm --filter @nest-auth-example/api add -D \
  @stryker-mutator/core@^9 \
  @stryker-mutator/jest-runner@^9 \
  @stryker-mutator/typescript-checker@^9

# Web
pnpm --filter @nest-auth-example/web add -D \
  @stryker-mutator/core@^9 \
  @stryker-mutator/vitest-runner@^9
```

After both installs, run `pnpm install` at the root to refresh `pnpm-lock.yaml`
fully (the `--filter add` commands already update the lockfile but a root
install confirms hoisting).

---

## 6. Mutate-pattern decision matrix

This table explains every inclusion/exclusion in the `mutate` array so a future
agent can decide what to do with a new file without guessing.

### 6.1 `apps/api`

| Path pattern             | Mutate? | Reason                                                                                 |
| ------------------------ | ------- | -------------------------------------------------------------------------------------- |
| `src/**/*.service.ts`    | ✅ Yes  | Pure business logic — main target                                                      |
| `src/**/*.controller.ts` | ✅ Yes  | Request handling logic, status codes, payload shaping                                  |
| `src/**/*.guard.ts`      | ✅ Yes  | Authorization decisions — highest blast radius                                         |
| `src/**/*.filter.ts`     | ✅ Yes  | Exception mapping — wrong status code = security bug                                   |
| `src/**/*.provider.ts`   | ✅ Yes  | Repository implementations, side-effect bindings                                       |
| `src/**/*.hooks.ts`      | ✅ Yes  | Auth hooks: token rotation, MFA flows                                                  |
| `src/**/*.config.ts`     | ✅ Yes  | Config builders — wrong default = real bug                                             |
| `src/**/*.module.ts`     | ❌ No   | Pure DI metadata; no runtime logic to mutate                                           |
| `src/**/*.dto.ts`        | ❌ No   | class-validator decorators; mutating them creates type errors, not behavioural mutants |
| `src/main.ts`            | ❌ No   | Bootstrap, not unit-tested by design (covered by e2e)                                  |
| `src/**/*.d.ts`          | ❌ No   | Type-only declarations                                                                 |
| `src/**/index.ts`        | ❌ No   | Barrel re-exports                                                                      |
| `src/**/*.spec.ts`       | ❌ No   | The tests themselves                                                                   |
| `test/**`                | ❌ No   | E2E specs (Playwright/supertest), excluded from sandbox via `ignorePatterns`           |

### 6.2 `apps/web`

| Path pattern          | Mutate? | Reason                                                                                                                                           |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/**/*.ts`         | ✅ Yes  | Pure modules: auth-client, ws-client, auth-errors, tenants, env, require-auth, qrcode — all unit-tested in jsdom                                 |
| `components/**/*.tsx` | ✅ Yes  | React components with unit tests (Vitest + Testing Library)                                                                                      |
| `components/**/*.ts`  | ✅ Yes  | Component helpers                                                                                                                                |
| `app/**/*.tsx`        | ❌ No   | Next.js pages/layouts/route handlers — use Server Components and `cookies()`/`redirect()`, only runnable in a Next server. Covered by Playwright |
| `app/**/*.ts`         | ❌ No   | Same as above                                                                                                                                    |
| `e2e/**`              | ❌ No   | Playwright specs                                                                                                                                 |
| `**/*.test.ts(x)`     | ❌ No   | The tests themselves                                                                                                                             |
| `**/*.config.ts`      | ❌ No   | Build/tool configs                                                                                                                               |
| `**/*.d.ts`           | ❌ No   | Type-only                                                                                                                                        |
| `**/index.ts`         | ❌ No   | Barrels                                                                                                                                          |
| `proxy.ts`            | ❌ No   | Single root file; behaviour is verified by e2e against a live API                                                                                |

If a new file type is introduced and it has unit tests, **default to mutating
it**. Only exclude with an explicit reason recorded in `docs/stryker/HISTORY.md`.

---

## 7. CI workflow — `.github/workflows/mutation.yml`

**Created in Phase 2, not Phase 0.** Phase 0 runs strictly locally.

```yaml
name: Mutation Testing

on:
  push:
    branches: [main]
  pull_request:
    types: [labeled, opened, synchronize, reopened]

jobs:
  mutation:
    # Run only when label `run-mutation` is present, or on main push.
    if: >
      github.event_name == 'push' ||
      contains(github.event.pull_request.labels.*.name, 'run-mutation')
    runs-on: ubuntu-latest
    timeout-minutes: 45

    strategy:
      fail-fast: false
      matrix:
        app: [api, web]

    services:
      # API needs Postgres + Redis for the supertest-driven integration specs.
      postgres:
        image: postgres:18
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: example_app_test
        ports: ['55432:5432']
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7
        ports: ['6379:6379']

    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - uses: pnpm/action-setup@v4
        with: { version: 10.8.0 }

      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Restore incremental cache
        uses: actions/cache@v4
        with:
          path: apps/${{ matrix.app }}/reports/stryker-incremental.json
          key: stryker-${{ matrix.app }}-${{ github.base_ref || github.ref_name }}
          restore-keys: |
            stryker-${{ matrix.app }}-

      - name: Run mutation tests
        run: pnpm mutation:${{ matrix.app }} -- --incremental

      - name: Upload HTML report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: mutation-${{ matrix.app }}-report
          path: apps/${{ matrix.app }}/reports/mutation/${{ matrix.app }}.html
          retention-days: 14
```

**Notes**:

- Phase 2 only flips `if: …` to be always-on, not label-gated, once the team
  is comfortable.
- `fetch-depth: 0` is required so incremental mode can diff against base.
- The Postgres/Redis services only matter for the API matrix slot; leaving
  them up for the web slot is harmless and keeps the workflow uniform.
- `continue-on-error` is **not** set: once Phase 2 lands, a regression below
  the `break` threshold MUST fail CI.

---

## 8. Risk register

| #   | Risk                                                                         | Severity | Likelihood | Mitigation                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------- | -------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `--experimental-vm-modules` breaks jest-runner sandbox                       | High     | Low        | `testRunnerNodeArgs: ["--experimental-vm-modules"]` in config; dry-run in Phase 0 step 7 catches it                                                                              |
| 2   | Custom `jest-ts-transform.cjs` conflicts with Stryker instrumentation        | Medium   | Low        | Stryker does AST-level mutation, not Istanbul instrumentation. The transformer only injects `/* istanbul ignore next */` which Stryker ignores. Validated during Phase 0 dry-run |
| 3   | Vitest 4 + `@stryker-mutator/vitest-runner@^9` peer-dep mismatch             | Medium   | Medium     | If install fails, try `vitest-runner@latest` first; if still broken, downgrade Vitest to the latest minor the runner declares; document in HISTORY.md                            |
| 4   | TS checker rejects valid NestJS code that compiles via ts-jest               | Medium   | Medium     | `disableTypeChecks: "src/**/*.{ts,tsx}"` + `prioritizePerformanceOverAccuracy: true`. If still flaky, drop the checker for API too                                               |
| 5   | Total runtime > 30 min                                                       | Medium   | Medium     | `coverageAnalysis: perTest` + `ignoreStatic` + `enableFindRelatedTests` + `concurrency: 4`. Use `mutation:incremental` for dev                                                   |
| 6   | Mutants in auto-generated code (Prisma client)                               | Low      | Low        | Prisma client lives under `node_modules/.prisma`; `mutate` does not include `node_modules`. No action needed unless a future setup vendors the client                            |
| 7   | `exactOptionalPropertyTypes` causes survived mutants in spread patterns      | Low      | Medium     | Document the pattern in `mutation-testing-guidelines.md` § "Equivalent mutants — known patterns"; use targeted `// Stryker disable next-line`                                    |
| 8   | HTML reports get accidentally committed                                      | Low      | Medium     | `.gitignore` updated in Phase 0 step 5                                                                                                                                           |
| 9   | Sibling library's stryker config drifts and we forget to mirror improvements | Low      | High       | Add a quarterly check note in `HISTORY.md`; pin the sibling commit hash referenced when configs diverge                                                                          |
| 10  | A future agent adds `// Stryker disable all` without justification           | Medium   | High       | `/bymax-quality:code-review` skill rule: any `// Stryker disable` without a colon-reason is a CRITICAL finding                                                                   |

---

## 9. Definition of Done — Phase 0

A Phase 0 PR is mergeable when **every** box below is checked:

- [ ] `pnpm install` succeeds with the new devDeps in both workspaces.
- [ ] `pnpm test` passes with **100%** coverage in both apps (unchanged from before).
- [ ] `pnpm typecheck` returns 0 errors.
- [ ] `pnpm lint` returns 0 errors. No `// eslint-disable` was added.
- [ ] `pnpm format:check` passes.
- [ ] `pnpm mutation:api` runs end-to-end and produces
      `apps/api/reports/mutation/api.html`.
- [ ] `pnpm mutation:web` runs end-to-end and produces
      `apps/web/reports/mutation/web.html`.
- [ ] `pnpm mutation:dry-run` (both apps) exits 0.
- [ ] `apps/api/stryker.config.json` and `apps/web/stryker.config.json` exist
      and validate against the `$schema`.
- [ ] `apps/api/jest.stryker.config.ts` exists with the JSDoc header from §4.2.
- [ ] Root `package.json` has all six `mutation*` scripts from §4.4.
- [ ] Each workspace `package.json` has the three local `mutation*` scripts.
- [ ] `.gitignore` excludes `.stryker-tmp/`, `reports/mutation/`,
      `reports/stryker-incremental.json`, `stryker.log`.
- [ ] `eslint.config.mjs` ignores the same artefact paths.
- [ ] `CLAUDE.md` mentions mutation testing in the on-demand guideline map
      and in the verification section.
- [ ] `docs/guidelines/mutation-testing-guidelines.md` exists with all
      sections from §4.10.
- [ ] `docs/stryker/BASELINE.md` exists with real numbers from the run.
- [ ] No `// @ts-ignore`, `// @ts-expect-error`, `as any`, `// eslint-disable`,
      `// Stryker disable` were introduced in this PR.
- [ ] No `enum` introduced.
- [ ] No production code was modified (only configs and docs).
- [ ] All new file headers and JSDoc comments are in English.
- [ ] PR description includes:
  - Baseline mutation score per app (copied from BASELINE.md).
  - Total runtime per app.
  - Top 5 files by surviving-mutant count per app (for triage in Phase 1).

---

## 10. Out of scope (explicit)

The following are **deliberately excluded** from this plan and must not be
attempted in the same PR(s):

- ❌ Stryker Dashboard integration (token, badge, public URL). Separate ADR.
- ❌ Mutating `apps/web/app/**` (Next.js pages/layouts/route handlers).
  These are server-side and are validated by Playwright, not Vitest.
- ❌ Mutating `apps/api/test/**` (e2e specs run by supertest).
- ❌ Replacing the custom `jest-ts-transform.cjs` with anything else.
- ❌ Migrating `apps/web` from Vitest to Jest "for uniformity".
  `vitest-runner` is officially supported.
- ❌ Raising `break` threshold above 80 in Phase 0 — that is Phase 2's job.
- ❌ Editing any source file in `apps/*/src/`, `apps/web/lib/`, or
  `apps/web/components/` during Phase 0. Phase 1 is the time to strengthen
  tests.
- ❌ Adding `// Stryker disable` comments in Phase 0 (no surviving mutants
  have been triaged yet).
- ❌ Changing `coverageThreshold` in `jest.config.ts` or
  `vitest.config.ts` — coverage stays at 100%.

---

## 11. Reference links

- [Stryker JS docs](https://stryker-mutator.io/docs/stryker-js/introduction/)
- [Stryker configuration reference](https://stryker-mutator.io/docs/stryker-js/configuration/)
- [Jest runner](https://stryker-mutator.io/docs/stryker-js/jest-runner/)
- [Vitest runner](https://stryker-mutator.io/docs/stryker-js/vitest-runner/)
- [TypeScript checker](https://stryker-mutator.io/docs/stryker-js/typescript-checker/)
- [Disabling mutants](https://stryker-mutator.io/docs/stryker-js/disable-mutants/)
- [Incremental mode](https://stryker-mutator.io/docs/stryker-js/incremental/)
- Sibling reference: `/Users/maximiliano/Documents/MyApps/nest-auth/stryker.config.json`
- Sibling Jest-Stryker wrapper: `/Users/maximiliano/Documents/MyApps/nest-auth/jest.stryker.config.ts`

---

## 12. Agent execution checklist (Phase 0, in order)

A coding agent picking up Phase 0 should execute this exact sequence. Do not
reorder.

1. Read `CLAUDE.md` and `docs/guidelines/coding-style.md`.
2. Read this document fully.
3. Read `apps/api/jest.config.ts`, `apps/api/jest-ts-transform.cjs`,
   `apps/api/tsconfig.spec.json`, `apps/web/vitest.config.ts`.
4. Read the sibling configs:
   - `/Users/maximiliano/Documents/MyApps/nest-auth/stryker.config.json`
   - `/Users/maximiliano/Documents/MyApps/nest-auth/jest.stryker.config.ts`
5. Run `pnpm install` to confirm the working tree is clean.
6. Run `pnpm test:cov` and verify 100% coverage in both apps. **Do not
   proceed if coverage is below 100%** — that is a pre-existing bug, not
   something this PR should mask.
7. Install API devDeps (command in §5).
8. Install web devDeps (command in §5).
9. Create `apps/api/stryker.config.json` (§4.1).
10. Create `apps/api/jest.stryker.config.ts` (§4.2).
11. Create `apps/web/stryker.config.json` (§4.3).
12. Update root `package.json` (§4.4).
13. Update `apps/api/package.json` (§4.5).
14. Update `apps/web/package.json` (§4.6).
15. Update `.gitignore` (§4.7).
16. Update `eslint.config.mjs` (§4.8).
17. Update `CLAUDE.md` (§4.9).
18. Create `docs/guidelines/mutation-testing-guidelines.md` (§4.10).
19. Run `pnpm install` again to refresh the lockfile.
20. Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`. Fix any issue
    by changing the code (not by suppressing the rule).
21. Run `pnpm test:cov` once more. Confirm 100% coverage in both apps.
22. Run `pnpm mutation:dry-run`. Expect exit 0 in both apps.
23. Run `pnpm mutation:api`. Capture full stdout. Note runtime and score.
24. Run `pnpm mutation:web`. Same.
25. Open both HTML reports and inspect them by eye for sanity.
26. Create `docs/stryker/BASELINE.md` (§4.11) with the real numbers.
27. Re-run the DoD checklist in §9. Tick every box.
28. Stage all changes. **Do not commit.** Hand off to the user with:
    - the diff summary,
    - the baseline scores,
    - the top-5 surviving-mutant files per app for Phase 1 triage,
    - the suggested commit message
      (`feat(stryker): add mutation testing baseline for api and web`).
29. Wait for user approval. The user runs `git commit` and `git push`.

---

**End of plan. Awaiting user approval to execute Phase 0.**
