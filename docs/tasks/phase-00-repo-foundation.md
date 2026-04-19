# Phase 0 — Repository Foundation & Tooling — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-0--repository-foundation--tooling) §Phase 0
> **Total tasks:** 10
> **Progress:** 🟢 10 / 10 done (100%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID    | Task                                                               | Status | Priority | Size | Depends on       |
| ----- | ------------------------------------------------------------------ | ------ | -------- | ---- | ---------------- |
| P0-1  | Root `package.json` + `pnpm-workspace.yaml`                        | 🟢     | High     | S    | —                |
| P0-2  | Node version pinning (`.nvmrc` + `engines`)                        | 🟢     | High     | XS   | P0-1             |
| P0-3  | `.gitignore` + `.editorconfig`                                     | 🟢     | High     | XS   | —                |
| P0-4  | Root `tsconfig.base.json`                                          | 🟢     | High     | S    | P0-1             |
| P0-5  | ESLint flat config (`eslint.config.mjs`)                           | 🟢     | High     | S    | P0-1, P0-4       |
| P0-6  | Prettier (`.prettierrc.mjs`, `.prettierignore`)                    | 🟢     | High     | XS   | P0-1             |
| P0-7  | Husky + lint-staged + commitlint                                   | 🟢     | High     | S    | P0-1, P0-5, P0-6 |
| P0-8  | Root `.env.example` scaffold                                       | 🟢     | Medium   | XS   | P0-1             |
| P0-9  | `README.md` + `LICENSE` + `CHANGELOG.md` + `CONTRIBUTING.md` stubs | 🟢     | Medium   | XS   | —                |
| P0-10 | Verification: `pnpm install && pnpm typecheck && pnpm lint`        | 🟢     | High     | S    | P0-1..P0-9       |

---

## P0-1 — Root `package.json` + `pnpm-workspace.yaml`

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S (30–90 min)
- **Depends on:** `—`

### Description

Create the workspace-root `package.json` and `pnpm-workspace.yaml` that register `apps/*` (and `packages/*` as optional). This file is the anchor for every subsequent phase; scripts declared here are dispatched via `pnpm -r` / `pnpm --filter`.

### Acceptance Criteria

- [x] Root `package.json` exists with `"name": "nest-auth-example"`, `"private": true`, `"type": "module"`.
- [x] Declares `"packageManager": "pnpm@10.8.0"` (or the latest 10.8.x).
- [x] Scripts defined: `dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e`, `format`, `prepare`.
- [x] `pnpm-workspace.yaml` registers `apps/*` and `packages/*`.
- [x] `pnpm install` completes with zero errors on an empty workspace.

### Files to create / modify

- `package.json` — workspace root manifest.
- `pnpm-workspace.yaml` — workspace globs.

### Agent Execution Prompt

> Role: Senior TypeScript / Node engineer setting up a pnpm workspace.
> Context: Repo `nest-auth-example` is the reference app for `@bymax-one/nest-auth` (see `docs/DEVELOPMENT_PLAN.md` §Phase 0 and §2 Global Conventions). This is task P0-1.
> Objective: Produce the workspace-root `package.json` + `pnpm-workspace.yaml`.
> Steps:
>
> 1. Create `/package.json` with the fields listed in Acceptance Criteria. Scripts should use `pnpm -r` fan-out (e.g., `"typecheck": "pnpm -r run typecheck"`, `"lint": "pnpm -r run lint"`). `prepare` must run `husky` (task P0-7 finishes the wiring).
> 2. Create `/pnpm-workspace.yaml` containing:
>    ```yaml
>    packages:
>      - 'apps/*'
>      - 'packages/*'
>    ```
> 3. Do NOT add any runtime dependencies yet; devDependencies may be empty at this step.
> 4. Run `pnpm install` to materialize the lockfile.
>    Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 global conventions (pnpm ^10.8, ESM-only, Node >=24 pinned in P0-2).
> - Do NOT add React/Next/Nest deps here; they belong to app packages in later phases.
>   Verification:
> - `pnpm install` — expected: exits 0, creates `pnpm-lock.yaml`.
> - `pnpm -v` — expected: `>=10.8.0`.

### Completion Protocol

1. ✅ Edit this task's `Status` line → `🟢 Done`.
2. ✅ Tick every box in **Acceptance Criteria**.
3. ✅ Update this task's row in the **Task index**.
4. ✅ Increment the **Progress** counter in the file header.
5. ✅ Update the matching row in [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) (Done / Total, %, Status).
6. ✅ Recompute "Overall progress" in `DEVELOPMENT_PLAN.md` (sum / 126).
7. ✅ Append `- P0-1 ✅ YYYY-MM-DD — <one-line summary>` to **Completion log**.

If phase reaches 100%, switch its row status in `DEVELOPMENT_PLAN.md` to 🟢.

⚠️ Never mark done with failing verification.

---

## P0-2 — Node Version Pinning (`.nvmrc` + `engines`)

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** XS (<30 min)
- **Depends on:** `P0-1`

### Description

Pin the Node.js major version to `24` via `.nvmrc` and declare it in `package.json` under `engines`. Library `@bymax-one/nest-auth` requires Node >=24, so this guard prevents silent version drift on contributor machines and CI.

### Acceptance Criteria

- [x] `.nvmrc` exists and contains exactly `24` (no newline-only file, no trailing `.x`).
- [x] Root `package.json` has `"engines": { "node": ">=24", "pnpm": ">=10.8" }`.
- [x] Running `nvm use` in the repo root selects Node 24.

### Files to create / modify

- `.nvmrc` — single line: `24`.
- `package.json` — add `engines` block.

### Agent Execution Prompt

> Role: Senior TypeScript / Node engineer.
> Context: Task P0-2 of `docs/DEVELOPMENT_PLAN.md` §Phase 0. Library requires Node >=24.
> Objective: Pin Node runtime and PNPM version across the repo.
> Steps:
>
> 1. Create `/.nvmrc` with the single line `24`.
> 2. Edit `/package.json` (from P0-1) — add:
>    ```json
>    "engines": {
>      "node": ">=24",
>      "pnpm": ">=10.8"
>    }
>    ```
>    Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 global conventions.
> - Do NOT use `engineStrict` overrides; keep defaults.
>   Verification:
> - `node -p "require('./package.json').engines.node"` — expected: `>=24`.
> - `cat .nvmrc` — expected: `24`.

### Completion Protocol

1. ✅ Edit this task's `Status` line → `🟢 Done`.
2. ✅ Tick every box in **Acceptance Criteria**.
3. ✅ Update this task's row in the **Task index**.
4. ✅ Increment the **Progress** counter in the file header.
5. ✅ Update the matching row in [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) (Done / Total, %, Status).
6. ✅ Recompute "Overall progress" in `DEVELOPMENT_PLAN.md` (sum / 126).
7. ✅ Append `- P0-2 ✅ YYYY-MM-DD — <one-line summary>` to **Completion log**.

If phase reaches 100%, switch its row status in `DEVELOPMENT_PLAN.md` to 🟢.

⚠️ Never mark done with failing verification.

---

## P0-3 — `.gitignore` + `.editorconfig`

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** XS (<30 min)
- **Depends on:** `—`

### Description

Add the standard ignore rules so generated directories never land in history, and `.editorconfig` so every IDE agrees on line endings and indentation. `pnpm-lock.yaml` is deliberately NOT ignored — lockfile commits are part of the workflow.

### Acceptance Criteria

- [x] `.gitignore` covers `node_modules/`, `dist/`, `.next/`, `coverage/`, `*.log`, `.env`, `.env.*` (but NOT `.env.example`), `.DS_Store`.
- [x] `.gitignore` does NOT ignore `pnpm-lock.yaml`.
- [x] `.editorconfig` sets LF line endings, UTF-8, 2-space indent, insert final newline, trim trailing whitespace.

### Files to create / modify

- `.gitignore` — repo-wide ignores.
- `.editorconfig` — repo-wide editor settings.

### Agent Execution Prompt

> Role: Senior TypeScript / Node engineer.
> Context: Task P0-3 of `docs/DEVELOPMENT_PLAN.md` §Phase 0.
> Objective: Produce `.gitignore` and `.editorconfig`.
> Steps:
>
> 1. Create `/.editorconfig` with this exact content:
>
>    ```ini
>    root = true
>
>    [*]
>    charset = utf-8
>    end_of_line = lf
>    indent_style = space
>    indent_size = 2
>    insert_final_newline = true
>    trim_trailing_whitespace = true
>
>    [*.md]
>    trim_trailing_whitespace = false
>    ```
>
> 2. Create `/.gitignore` covering: `node_modules/`, `dist/`, `build/`, `.next/`, `coverage/`, `*.tsbuildinfo`, `.turbo/`, `.env`, `.env.*`, `!.env.example`, `*.log`, `.DS_Store`, `Thumbs.db`, `.vscode/*`, `!.vscode/settings.json`, `!.vscode/extensions.json`.
> 3. Do NOT ignore `pnpm-lock.yaml`.
>    Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 global conventions.
>   Verification:
> - `git check-ignore -v pnpm-lock.yaml` — expected: no output, exit 1 (not ignored).
> - `git check-ignore -v node_modules/foo` — expected: match against `.gitignore`.

### Completion Protocol

1. ✅ Edit this task's `Status` line → `🟢 Done`.
2. ✅ Tick every box in **Acceptance Criteria**.
3. ✅ Update this task's row in the **Task index**.
4. ✅ Increment the **Progress** counter in the file header.
5. ✅ Update the matching row in [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) (Done / Total, %, Status).
6. ✅ Recompute "Overall progress" in `DEVELOPMENT_PLAN.md` (sum / 126).
7. ✅ Append `- P0-3 ✅ YYYY-MM-DD — <one-line summary>` to **Completion log**.

If phase reaches 100%, switch its row status in `DEVELOPMENT_PLAN.md` to 🟢.

⚠️ Never mark done with failing verification.

---

## P0-4 — Root `tsconfig.base.json`

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S (30–90 min)
- **Depends on:** `P0-1`

### Description

Create the canonical TypeScript base configuration inherited by every app/package `tsconfig.json`. `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` are required by §2 Global Conventions.

### Acceptance Criteria

- [x] `tsconfig.base.json` at repo root.
- [x] `compilerOptions` sets `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `target: "ES2023"`, `module: "ESNext"`, `moduleResolution: "Bundler"`, `esModuleInterop: true`, `skipLibCheck: true`, `resolveJsonModule: true`, `forceConsistentCasingInFileNames: true`, `isolatedModules: true`, `verbatimModuleSyntax: true`.
- [x] No `include`/`exclude` (base config is pure options).
- [x] Root `package.json` adds `devDependencies: { "typescript": "^5.6.0" }`.

### Files to create / modify

- `tsconfig.base.json` — shared compiler options.
- `package.json` — add `typescript` to devDependencies.

### Agent Execution Prompt

> Role: Senior TypeScript engineer.
> Context: Task P0-4 of `docs/DEVELOPMENT_PLAN.md` §Phase 0. All apps extend this base; see §2 Global Conventions.
> Objective: Produce `/tsconfig.base.json` with the strict settings listed.
> Steps:
>
> 1. Install TypeScript at the workspace root: `pnpm add -D -w typescript@^5.6.0`.
> 2. Create `/tsconfig.base.json` with:
>    ```json
>    {
>      "compilerOptions": {
>        "target": "ES2023",
>        "module": "ESNext",
>        "moduleResolution": "Bundler",
>        "lib": ["ES2023"],
>        "esModuleInterop": true,
>        "resolveJsonModule": true,
>        "isolatedModules": true,
>        "verbatimModuleSyntax": true,
>        "skipLibCheck": true,
>        "forceConsistentCasingInFileNames": true,
>        "strict": true,
>        "noUncheckedIndexedAccess": true,
>        "exactOptionalPropertyTypes": true,
>        "noImplicitOverride": true,
>        "noFallthroughCasesInSwitch": true
>      }
>    }
>    ```
>    Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 global conventions.
> - Do NOT set `paths` here; Phase 2 explicitly forbids monorepo path aliases.
>   Verification:
> - `pnpm exec tsc --showConfig -p tsconfig.base.json` — expected: emits the resolved config without error.

### Completion Protocol

1. ✅ Edit this task's `Status` line → `🟢 Done`.
2. ✅ Tick every box in **Acceptance Criteria**.
3. ✅ Update this task's row in the **Task index**.
4. ✅ Increment the **Progress** counter in the file header.
5. ✅ Update the matching row in [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) (Done / Total, %, Status).
6. ✅ Recompute "Overall progress" in `DEVELOPMENT_PLAN.md` (sum / 126).
7. ✅ Append `- P0-4 ✅ YYYY-MM-DD — <one-line summary>` to **Completion log**.

If phase reaches 100%, switch its row status in `DEVELOPMENT_PLAN.md` to 🟢.

⚠️ Never mark done with failing verification.

---

## P0-5 — ESLint Flat Config (`eslint.config.mjs`)

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S (30–90 min)
- **Depends on:** `P0-1`, `P0-4`

### Description

Wire ESLint v9 with the flat config format. Extends `@typescript-eslint/recommended-type-checked` per §2, adds Prettier compatibility, and sets up global ignores. Library-side ESLint preset will be imported later when published; for now this is a standalone baseline.

### Acceptance Criteria

- [x] `eslint.config.mjs` at repo root using flat config.
- [x] Integrates `@eslint/js`, `typescript-eslint` (`recommended-type-checked`), `eslint-config-prettier` (or `eslint-plugin-prettier/recommended`).
- [x] Ignores `**/dist`, `**/.next`, `**/coverage`, `**/node_modules`.
- [x] Root `package.json` has a `lint` script (`"lint": "eslint ."`).
- [x] `pnpm lint` exits 0 on an empty workspace (no source files yet).

### Files to create / modify

- `eslint.config.mjs` — flat config entry point.
- `package.json` — add ESLint devDependencies + `lint` script.

### Agent Execution Prompt

> Role: Senior TypeScript engineer.
> Context: Task P0-5 of `docs/DEVELOPMENT_PLAN.md` §Phase 0. §2 mandates ESLint v9 flat config + Prettier 3.
> Objective: Produce `/eslint.config.mjs` and install ESLint tooling.
> Steps:
>
> 1. Install devDependencies at the workspace root:
>    `pnpm add -D -w eslint@^9 @eslint/js typescript-eslint eslint-config-prettier globals`.
> 2. Create `/eslint.config.mjs`:
>
>    ```js
>    import js from '@eslint/js';
>    import tseslint from 'typescript-eslint';
>    import prettier from 'eslint-config-prettier';
>    import globals from 'globals';
>
>    export default tseslint.config(
>      { ignores: ['**/dist', '**/.next', '**/coverage', '**/node_modules', '**/*.d.ts'] },
>      js.configs.recommended,
>      ...tseslint.configs.recommendedTypeChecked,
>      {
>        languageOptions: {
>          globals: { ...globals.node },
>          parserOptions: {
>            projectService: true,
>            tsconfigRootDir: import.meta.dirname,
>          },
>        },
>      },
>      prettier,
>    );
>    ```
>
> 3. Add `"lint": "eslint ."` to root `package.json` scripts.
>    Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 global conventions.
> - Use flat config only; do NOT create a legacy `.eslintrc*`.
>   Verification:
> - `pnpm lint` — expected: exits 0 with no files matched message or clean output.

### Completion Protocol

1. ✅ Edit this task's `Status` line → `🟢 Done`.
2. ✅ Tick every box in **Acceptance Criteria**.
3. ✅ Update this task's row in the **Task index**.
4. ✅ Increment the **Progress** counter in the file header.
5. ✅ Update the matching row in [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) (Done / Total, %, Status).
6. ✅ Recompute "Overall progress" in `DEVELOPMENT_PLAN.md` (sum / 126).
7. ✅ Append `- P0-5 ✅ YYYY-MM-DD — <one-line summary>` to **Completion log**.

If phase reaches 100%, switch its row status in `DEVELOPMENT_PLAN.md` to 🟢.

⚠️ Never mark done with failing verification.

---

## P0-6 — Prettier (`.prettierrc.mjs` + `.prettierignore`)

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** XS (<30 min)
- **Depends on:** `P0-1`

### Description

Add Prettier 3 with an ESM config file and a matching ignore file. Integrates with ESLint via `eslint-config-prettier` (installed in P0-5). This is the single source of formatting truth for the repo.

### Acceptance Criteria

- [x] `.prettierrc.mjs` exists and exports a config object via `export default`.
- [x] `.prettierignore` covers `dist`, `.next`, `coverage`, `pnpm-lock.yaml`, `node_modules`.
- [x] Root `package.json` has a `format` script (`"format": "prettier --write ."`) and a `format:check` script (`"format:check": "prettier --check ."`).
- [x] `pnpm format:check` exits 0.

### Files to create / modify

- `.prettierrc.mjs` — config.
- `.prettierignore` — ignore list.
- `package.json` — add Prettier devDependency + scripts.

### Agent Execution Prompt

> Role: Senior TypeScript engineer.
> Context: Task P0-6 of `docs/DEVELOPMENT_PLAN.md` §Phase 0.
> Objective: Install Prettier 3 and configure it repo-wide.
> Steps:
>
> 1. `pnpm add -D -w prettier@^3`.
> 2. Create `/.prettierrc.mjs`:
>    ```js
>    /** @type {import("prettier").Config} */
>    export default {
>      printWidth: 100,
>      singleQuote: true,
>      trailingComma: 'all',
>      semi: true,
>      arrowParens: 'always',
>      endOfLine: 'lf',
>    };
>    ```
> 3. Create `/.prettierignore`:
>    ```
>    dist
>    .next
>    coverage
>    node_modules
>    pnpm-lock.yaml
>    ```
> 4. Add scripts to root `package.json`: `"format": "prettier --write ."`, `"format:check": "prettier --check ."`.
>    Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 global conventions.
>   Verification:
> - `pnpm format:check` — expected: exits 0 (matches) on an empty workspace.

### Completion Protocol

1. ✅ Edit this task's `Status` line → `🟢 Done`.
2. ✅ Tick every box in **Acceptance Criteria**.
3. ✅ Update this task's row in the **Task index**.
4. ✅ Increment the **Progress** counter in the file header.
5. ✅ Update the matching row in [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) (Done / Total, %, Status).
6. ✅ Recompute "Overall progress" in `DEVELOPMENT_PLAN.md` (sum / 126).
7. ✅ Append `- P0-6 ✅ YYYY-MM-DD — <one-line summary>` to **Completion log**.

If phase reaches 100%, switch its row status in `DEVELOPMENT_PLAN.md` to 🟢.

⚠️ Never mark done with failing verification.

---

## P0-7 — Husky + lint-staged + commitlint

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S (30–90 min)
- **Depends on:** `P0-1`, `P0-5`, `P0-6`

### Description

Wire Git hooks so every commit runs `lint-staged` (pre-commit) and `commitlint` (commit-msg). Enforces Conventional Commits per §2 Global Conventions and prevents unformatted code from reaching `main`.

### Acceptance Criteria

- [x] `husky` installed; `.husky/pre-commit` runs `pnpm exec lint-staged`.
- [x] `.husky/commit-msg` runs `pnpm exec commitlint --edit "$1"`.
- [x] `commitlint.config.mjs` extends `@commitlint/config-conventional`.
- [x] `lint-staged.config.mjs` runs `prettier --write` + `eslint --fix` on staged `*.{ts,tsx,js,jsx,mjs,cjs}`.
- [x] Root `package.json` has a `prepare` script (`"prepare": "husky"`), and `pnpm install` creates `.husky/_/`.
- [x] A commit with message `chore: bootstrap` succeeds; a commit with message `bad message` is rejected by commitlint.

### Files to create / modify

- `commitlint.config.mjs`
- `lint-staged.config.mjs`
- `.husky/pre-commit`
- `.husky/commit-msg`
- `package.json` — dev deps + `prepare` script.

### Agent Execution Prompt

> Role: Senior TypeScript engineer.
> Context: Task P0-7 of `docs/DEVELOPMENT_PLAN.md` §Phase 0. §2 mandates Conventional Commits via commitlint, plus Husky + lint-staged.
> Objective: Wire pre-commit and commit-msg Git hooks.
> Steps:
>
> 1. Install devDependencies:
>    `pnpm add -D -w husky lint-staged @commitlint/cli @commitlint/config-conventional`.
> 2. Ensure root `package.json` has `"prepare": "husky"` (added in P0-1; confirm here).
> 3. Run `pnpm exec husky init` then overwrite the generated hooks:
>    - `.husky/pre-commit` contents: `pnpm exec lint-staged`
>    - `.husky/commit-msg` contents: `pnpm exec commitlint --edit "$1"`
> 4. Make both hooks executable (`chmod +x .husky/pre-commit .husky/commit-msg`).
> 5. Create `/commitlint.config.mjs`:
>    ```js
>    export default { extends: ['@commitlint/config-conventional'] };
>    ```
> 6. Create `/lint-staged.config.mjs`:
>    ```js
>    export default {
>      '*.{ts,tsx,js,jsx,mjs,cjs}': ['prettier --write', 'eslint --fix'],
>      '*.{json,md,yml,yaml}': ['prettier --write'],
>    };
>    ```
>    Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 global conventions (Conventional Commits, Husky, lint-staged).
> - Do NOT skip hooks with `--no-verify` in verification.
>   Verification:
> - `echo "chore: bootstrap" | pnpm exec commitlint` — expected: exits 0.
> - `echo "bad message" | pnpm exec commitlint` — expected: exits non-zero.
> - `ls -la .husky/pre-commit .husky/commit-msg` — expected: both exist and are executable.

### Completion Protocol

1. ✅ Edit this task's `Status` line → `🟢 Done`.
2. ✅ Tick every box in **Acceptance Criteria**.
3. ✅ Update this task's row in the **Task index**.
4. ✅ Increment the **Progress** counter in the file header.
5. ✅ Update the matching row in [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) (Done / Total, %, Status).
6. ✅ Recompute "Overall progress" in `DEVELOPMENT_PLAN.md` (sum / 126).
7. ✅ Append `- P0-7 ✅ YYYY-MM-DD — <one-line summary>` to **Completion log**.

If phase reaches 100%, switch its row status in `DEVELOPMENT_PLAN.md` to 🟢.

⚠️ Never mark done with failing verification.

---

## P0-8 — Root `.env.example` Scaffold

- **Status:** 🟢 Done
- **Priority:** Medium
- **Size:** XS (<30 min)
- **Depends on:** `P0-1`

### Description

Create the repo-root `.env.example` that later phases populate incrementally. At this stage it only carries the shared variables from Appendix A (`NODE_ENV`, `LOG_LEVEL`, `PUBLIC_DOMAIN`). Phase 20 enforces that every Appendix A variable is represented here.

### Acceptance Criteria

- [x] `.env.example` at repo root contains `NODE_ENV`, `LOG_LEVEL`, `PUBLIC_DOMAIN` with inline comments.
- [x] `.env.example` is tracked by git (allow-listed in `.gitignore` from P0-3).
- [x] File ends with a trailing newline (editorconfig compliance).

### Files to create / modify

- `.env.example`

### Agent Execution Prompt

> Role: Senior TypeScript / Node engineer.
> Context: Task P0-8 of `docs/DEVELOPMENT_PLAN.md` §Phase 0. Appendix A lists every env var; this file scaffolds the shared section only.
> Objective: Create the initial `/.env.example`.
> Steps:
>
> 1. Create `/.env.example` with:
>    ```dotenv
>    # ---------------------------------------------------------------------------
>    # Shared environment variables (see docs/DEVELOPMENT_PLAN.md Appendix A)
>    # ---------------------------------------------------------------------------
>    NODE_ENV=development
>    LOG_LEVEL=info
>    # PUBLIC_DOMAIN=example.com   # optional; used by cookies.resolveDomains in prod
>    ```
> 2. Confirm `.gitignore` (from P0-3) does NOT ignore `.env.example` (the `!.env.example` rule must be present).
>    Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 global conventions + Appendix A.
> - Do NOT add API/web variables yet; those land in later phases.
>   Verification:
> - `git check-ignore -v .env.example` — expected: no output (file is tracked).
> - `cat .env.example` — expected: shows the three shared vars.

### Completion Protocol

1. ✅ Edit this task's `Status` line → `🟢 Done`.
2. ✅ Tick every box in **Acceptance Criteria**.
3. ✅ Update this task's row in the **Task index**.
4. ✅ Increment the **Progress** counter in the file header.
5. ✅ Update the matching row in [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) (Done / Total, %, Status).
6. ✅ Recompute "Overall progress" in `DEVELOPMENT_PLAN.md` (sum / 126).
7. ✅ Append `- P0-8 ✅ YYYY-MM-DD — <one-line summary>` to **Completion log**.

If phase reaches 100%, switch its row status in `DEVELOPMENT_PLAN.md` to 🟢.

⚠️ Never mark done with failing verification.

---

## P0-9 — `README.md` + `LICENSE` + `CHANGELOG.md` + `CONTRIBUTING.md` Stubs

- **Status:** 🟢 Done
- **Priority:** Medium
- **Size:** XS (<30 min)
- **Depends on:** `—`

### Description

Create the four top-level governance documents. Content is minimal at this stage — the README points to `docs/OVERVIEW.md` and `docs/DEVELOPMENT_PLAN.md`; the CHANGELOG has an empty `[Unreleased]` section; CONTRIBUTING references `OVERVIEW.md` §16; LICENSE is the canonical MIT text © Bymax One.

### Acceptance Criteria

- [x] `README.md` includes project name, one-paragraph intro, links to `docs/OVERVIEW.md` and `docs/DEVELOPMENT_PLAN.md`.
- [x] `LICENSE` contains the MIT license text with `Copyright (c) <current-year> Bymax One`.
- [x] `CHANGELOG.md` follows Keep-a-Changelog format with an empty `## [Unreleased]` section.
- [x] `CONTRIBUTING.md` references `docs/OVERVIEW.md` §16 (Contributing) and the Phase 0 tooling (commitlint/husky).

### Files to create / modify

- `README.md`
- `LICENSE`
- `CHANGELOG.md`
- `CONTRIBUTING.md`

### Agent Execution Prompt

> Role: Senior TypeScript engineer / technical writer.
> Context: Task P0-9 of `docs/DEVELOPMENT_PLAN.md` §Phase 0. These are governance stubs; later phases flesh them out.
> Objective: Create the four documents listed in Files to create / modify.
> Steps:
>
> 1. `/README.md`: one H1 (`# nest-auth-example`), one paragraph describing the project, a "Documentation" section linking to `docs/OVERVIEW.md` and `docs/DEVELOPMENT_PLAN.md`, and a "Status" line stating the repo is in scaffolding (Phase 0).
> 2. `/LICENSE`: standard MIT text. Copyright line: `Copyright (c) <YYYY> Bymax One` where `<YYYY>` is the current calendar year.
> 3. `/CHANGELOG.md`: Keep-a-Changelog header + `## [Unreleased]` section containing `- Initial scaffolding.` under `### Added`.
> 4. `/CONTRIBUTING.md`: brief intro, link to `docs/OVERVIEW.md` §16, note that commits must follow Conventional Commits (enforced by commitlint per P0-7) and that CI runs lint/typecheck/tests.
>    Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 global conventions.
> - Keep content concise; these are stubs, not finished docs.
>   Verification:
> - `ls README.md LICENSE CHANGELOG.md CONTRIBUTING.md` — expected: all four exist.
> - `grep -l "Bymax One" LICENSE` — expected: match.

### Completion Protocol

1. ✅ Edit this task's `Status` line → `🟢 Done`.
2. ✅ Tick every box in **Acceptance Criteria**.
3. ✅ Update this task's row in the **Task index**.
4. ✅ Increment the **Progress** counter in the file header.
5. ✅ Update the matching row in [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) (Done / Total, %, Status).
6. ✅ Recompute "Overall progress" in `DEVELOPMENT_PLAN.md` (sum / 126).
7. ✅ Append `- P0-9 ✅ YYYY-MM-DD — <one-line summary>` to **Completion log**.

If phase reaches 100%, switch its row status in `DEVELOPMENT_PLAN.md` to 🟢.

⚠️ Never mark done with failing verification.

---

## P0-10 — Verification: `pnpm install && pnpm typecheck && pnpm lint` on Empty Workspace

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S (30–90 min)
- **Depends on:** `P0-1`, `P0-2`, `P0-3`, `P0-4`, `P0-5`, `P0-6`, `P0-7`, `P0-8`, `P0-9`

### Description

Gate task for Phase 0 "Definition of done" per `DEVELOPMENT_PLAN.md`: prove that the scaffolded workspace installs cleanly, typechecks, and lints on an empty source tree. This also verifies the `typecheck` script exists and fans out over workspaces without error.

### Acceptance Criteria

- [x] Root `package.json` has a `typecheck` script (`"typecheck": "pnpm -r --if-present run typecheck"`; the workspace-root fallback also runs `tsc --noEmit -p tsconfig.base.json` equivalent if needed).
- [x] `pnpm install` exits 0.
- [x] `pnpm typecheck` exits 0.
- [x] `pnpm lint` exits 0.
- [x] `pnpm format:check` exits 0.

### Files to create / modify

- `package.json` — finalize the `typecheck` fan-out script if not already in place.

### Agent Execution Prompt

> Role: Senior TypeScript engineer.
> Context: Task P0-10 of `docs/DEVELOPMENT_PLAN.md` §Phase 0. Definition of done: `pnpm install && pnpm typecheck && pnpm lint` all green on an empty workspace.
> Objective: Confirm all Phase 0 tooling is operational and close out the phase.
> Steps:
>
> 1. Verify root `package.json` `scripts` include `dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e`, `format`, `format:check`, `prepare`.
> 2. Set `"typecheck"` to `"pnpm -r --if-present run typecheck"` (app-level tsconfigs will land in Phase 3+).
> 3. Run `pnpm install`, then the three verification commands below. All must exit 0.
> 4. If any command fails, diagnose and fix in the corresponding earlier task file, then return here.
>    Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 global conventions.
> - Do NOT skip hooks. Do NOT add source files to make `typecheck` pass artificially.
>   Verification:
> - `pnpm install` — expected: exit 0.
> - `pnpm typecheck` — expected: exit 0 (no workspace packages yet → no-op is acceptable).
> - `pnpm lint` — expected: exit 0.
> - `pnpm format:check` — expected: exit 0.

### Completion Protocol

1. ✅ Edit this task's `Status` line → `🟢 Done`.
2. ✅ Tick every box in **Acceptance Criteria**.
3. ✅ Update this task's row in the **Task index**.
4. ✅ Increment the **Progress** counter in the file header.
5. ✅ Update the matching row in [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) (Done / Total, %, Status).
6. ✅ Recompute "Overall progress" in `DEVELOPMENT_PLAN.md` (sum / 126).
7. ✅ Append `- P0-10 ✅ YYYY-MM-DD — <one-line summary>` to **Completion log**.

If phase reaches 100%, switch its row status in `DEVELOPMENT_PLAN.md` to 🟢.

⚠️ Never mark done with failing verification.

---

## Completion log

- P0-1 ✅ 2026-04-19 — Root package.json + pnpm-workspace.yaml created; lockfile materialized
- P0-2 ✅ 2026-04-19 — .nvmrc=24 and engines.node>=24 added to package.json
- P0-3 ✅ 2026-04-19 — .gitignore and .editorconfig created with standard rules
- P0-4 ✅ 2026-04-19 — tsconfig.base.json created with strict + ESM + Bundler moduleResolution
- P0-5 ✅ 2026-04-19 — ESLint v10 flat config with typescript-eslint recommendedTypeChecked + prettier compat
- P0-6 ✅ 2026-04-19 — Prettier 3 configured with .prettierrc.mjs and .prettierignore; format:check passes
- P0-7 ✅ 2026-04-19 — Husky + lint-staged + commitlint wired; pre-commit and commit-msg hooks verified
- P0-8 ✅ 2026-04-19 — .env.example scaffold with NODE_ENV, LOG_LEVEL, PUBLIC_DOMAIN
- P0-9 ✅ 2026-04-19 — README.md, LICENSE (MIT © Bymax One), CHANGELOG.md, CONTRIBUTING.md stubs created
- P0-10 ✅ 2026-04-19 — pnpm install, typecheck, lint, format:check all pass on empty workspace
