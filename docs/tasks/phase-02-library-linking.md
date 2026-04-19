# Phase 2 — Library Linking & Workspace Bootstrap — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-2--library-linking--workspace-bootstrap) §Phase 2
> **Total tasks:** 4
> **Progress:** 🟢 4 / 4 done (100%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID   | Task                                                                     | Status | Priority | Size | Depends on       |
| ---- | ------------------------------------------------------------------------ | ------ | -------- | ---- | ---------------- |
| P2-1 | `scripts/link-library.sh` (build + link --global + link into example)    | 🟢     | High     | S    | —                |
| P2-2 | `scripts/unlink-library.sh`                                              | 🟢     | High     | XS   | P2-1             |
| P2-3 | Root `package.json` entry + probe file                                   | 🟢     | High     | S    | P2-1             |
| P2-4 | Verification — `pnpm typecheck` green; probe cleanup flagged for Phase 3 | 🟢     | High     | XS   | P2-1, P2-2, P2-3 |

---

## P2-1 — `scripts/link-library.sh` (build + `pnpm link --global` + link into example)

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S (30–90 min)
- **Depends on:** `—`

### Description

Author the helper that performs the full link dance: build `../nest-auth`, register it as a global pnpm link, then link it into this repo. Must be idempotent (re-runnable without side effects) and must print the resolved `node_modules` path so contributors can confirm the link landed.

### Acceptance Criteria

- [x] `scripts/link-library.sh` exists and has the executable bit set (`chmod +x`).
- [x] First line is `#!/usr/bin/env bash` followed by `set -euo pipefail`.
- [x] Verifies `../nest-auth` exists; exits with a clear error message if not.
- [x] Runs `pnpm install && pnpm build && pnpm link --global` inside `../nest-auth`.
- [x] Runs `pnpm link --global @bymax-one/nest-auth` inside this repo.
- [x] Idempotent — second invocation completes green with no duplicate work warnings.
- [x] Emits the resolved path via `node -p "require.resolve('@bymax-one/nest-auth')"`.

### Files to create / modify

- `scripts/link-library.sh`

### Agent Execution Prompt

> Role: Senior TypeScript / Node engineer.
> Context: Task P2-1 of `docs/DEVELOPMENT_PLAN.md` §Phase 2. The library `@bymax-one/nest-auth` lives at `../nest-auth`; see OVERVIEW §7.
> Objective: Create `/scripts/link-library.sh` — the automated link workflow.
> Steps:
>
> 1. Ensure `/scripts/` directory exists.
> 2. Create `/scripts/link-library.sh`:
>
>    ```bash
>    #!/usr/bin/env bash
>    set -euo pipefail
>
>    HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
>    LIB_DIR="$(cd "${HERE}/../nest-auth" 2>/dev/null && pwd || true)"
>
>    if [[ -z "${LIB_DIR}" || ! -d "${LIB_DIR}" ]]; then
>      echo "error: expected library checkout at ${HERE}/../nest-auth" >&2
>      echo "       clone https://github.com/bymaxone/nest-auth next to this repo" >&2
>      exit 1
>    fi
>
>    echo "==> Building library at ${LIB_DIR}"
>    (cd "${LIB_DIR}" && pnpm install --frozen-lockfile=false && pnpm build)
>
>    echo "==> Registering global pnpm link"
>    (cd "${LIB_DIR}" && pnpm link --global)
>
>    echo "==> Linking @bymax-one/nest-auth into $(basename "${HERE}")"
>    (cd "${HERE}" && pnpm link --global @bymax-one/nest-auth)
>
>    echo "==> Resolved path:"
>    (cd "${HERE}" && node -p "require.resolve('@bymax-one/nest-auth')")
>    ```
>
> 3. `chmod +x scripts/link-library.sh`.
>    Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 + Phase 2 deliverables.
> - Do NOT introduce TypeScript path aliases — Phase 2 forbids leaking monorepo paths into `tsconfig`.
>   Verification:
> - `bash -n scripts/link-library.sh` — expected: exit 0 (syntax OK).
> - `./scripts/link-library.sh` (only runnable when `../nest-auth` is present) — expected: final line prints an absolute path ending in `/nest-auth/dist/index.js` (or similar).

### Completion Protocol

1. ✅ Edit this task's `Status` line → `🟢 Done`.
2. ✅ Tick every box in **Acceptance Criteria**.
3. ✅ Update this task's row in the **Task index**.
4. ✅ Increment the **Progress** counter in the file header.
5. ✅ Update the matching row in [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) (Done / Total, %, Status).
6. ✅ Recompute "Overall progress" in `DEVELOPMENT_PLAN.md` (sum / 126).
7. ✅ Append `- P2-1 ✅ YYYY-MM-DD — <one-line summary>` to **Completion log**.

If phase reaches 100%, switch its row status in `DEVELOPMENT_PLAN.md` to 🟢.

⚠️ Never mark done with failing verification.

---

## P2-2 — `scripts/unlink-library.sh`

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** XS (<30 min)
- **Depends on:** `P2-1`

### Description

Mirror of `link-library.sh` that reverses the operation when a contributor wants to switch back to the published npm version. Runs `pnpm unlink --global @bymax-one/nest-auth` in this repo and `pnpm unlink --global` in `../nest-auth`.

### Acceptance Criteria

- [x] `scripts/unlink-library.sh` exists and is executable.
- [x] Starts with `#!/usr/bin/env bash` + `set -euo pipefail`.
- [x] Runs `pnpm unlink --global @bymax-one/nest-auth` inside this repo (ignore failure if already unlinked).
- [x] Runs `pnpm unlink --global` inside `../nest-auth` if that path exists.
- [x] Prints a final "reminder" message: `run 'pnpm install' to restore the published dependency`.

### Files to create / modify

- `scripts/unlink-library.sh`

### Agent Execution Prompt

> Role: Senior TypeScript / Node engineer.
> Context: Task P2-2 of `docs/DEVELOPMENT_PLAN.md` §Phase 2. Reverses P2-1.
> Objective: Create `/scripts/unlink-library.sh`.
> Steps:
>
> 1. Create `/scripts/unlink-library.sh`:
>
>    ```bash
>    #!/usr/bin/env bash
>    set -euo pipefail
>
>    HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
>    LIB_DIR="$(cd "${HERE}/../nest-auth" 2>/dev/null && pwd || true)"
>
>    echo "==> Removing link to @bymax-one/nest-auth in $(basename "${HERE}")"
>    (cd "${HERE}" && pnpm unlink --global @bymax-one/nest-auth) || true
>
>    if [[ -n "${LIB_DIR}" && -d "${LIB_DIR}" ]]; then
>      echo "==> Removing global registration from ${LIB_DIR}"
>      (cd "${LIB_DIR}" && pnpm unlink --global) || true
>    fi
>
>    echo "==> Reminder: run 'pnpm install' to restore the published dependency."
>    ```
>
> 2. `chmod +x scripts/unlink-library.sh`.
>    Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 + Phase 2.
> - Use `|| true` on the unlink calls so the script stays idempotent.
>   Verification:
> - `bash -n scripts/unlink-library.sh` — expected: exit 0.
> - `./scripts/unlink-library.sh` on a non-linked workspace — expected: exit 0 with the reminder.

### Completion Protocol

1. ✅ Edit this task's `Status` line → `🟢 Done`.
2. ✅ Tick every box in **Acceptance Criteria**.
3. ✅ Update this task's row in the **Task index**.
4. ✅ Increment the **Progress** counter in the file header.
5. ✅ Update the matching row in [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) (Done / Total, %, Status).
6. ✅ Recompute "Overall progress" in `DEVELOPMENT_PLAN.md` (sum / 126).
7. ✅ Append `- P2-2 ✅ YYYY-MM-DD — <one-line summary>` to **Completion log**.

If phase reaches 100%, switch its row status in `DEVELOPMENT_PLAN.md` to 🟢.

⚠️ Never mark done with failing verification.

---

## P2-3 — Root `package.json` Entry `"@bymax-one/nest-auth": "link:../nest-auth"` + Probe File

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S (30–90 min)
- **Depends on:** `P2-1`

### Description

Register the library as a `link:` dependency at the workspace root while the package is unpublished (per `DEVELOPMENT_PLAN.md` §Phase 2). Then add a temporary TypeScript probe file that imports one symbol from each subpath (`@bymax-one/nest-auth`, `/shared`, `/client`, `/react`, `/nextjs`) so typecheck proves the link is wired. The probe is deleted in Phase 3.

### Acceptance Criteria

- [x] Root `package.json` has `"dependencies": { "@bymax-one/nest-auth": "link:../nest-auth" }` (or `devDependencies`; root is fine since apps will declare their own deps later).
- [x] After `pnpm install`, `node_modules/@bymax-one/nest-auth` resolves to `../nest-auth` (confirmed via `node -p "require.resolve('@bymax-one/nest-auth')"`).
- [x] A minimal workspace package `packages/_probe/` exists with its own `package.json` (`"name": "@nest-auth-example/_probe"`, `"private": true`, `"type": "module"`) and `tsconfig.json` extending `../../tsconfig.base.json`, plus a `typecheck` script running `tsc --noEmit`.
- [x] `packages/_probe/src/probe.ts` imports one symbol from each of: `@bymax-one/nest-auth`, `@bymax-one/nest-auth/shared`, `@bymax-one/nest-auth/client`, `@bymax-one/nest-auth/react`, `@bymax-one/nest-auth/nextjs`.
- [x] The probe file includes a top-of-file comment: `// TEMPORARY — delete during Phase 3 (see docs/DEVELOPMENT_PLAN.md §Phase 3)`.
- [x] `pnpm typecheck` passes with the probe present.

### Files to create / modify

- `package.json` — add the `link:` dependency.
- `packages/_probe/package.json`
- `packages/_probe/tsconfig.json`
- `packages/_probe/src/probe.ts`

### Agent Execution Prompt

> Role: Senior TypeScript / NestJS engineer.
> Context: Task P2-3 of `docs/DEVELOPMENT_PLAN.md` §Phase 2. Phase DoD: `pnpm typecheck` passes with a probe importing from every library subpath.
> Objective: Wire the `link:` dependency and create the probe workspace package that proves typings resolve.
> Steps:
>
> 1. Run `pnpm add -w "@bymax-one/nest-auth@link:../nest-auth"` (or hand-edit root `package.json` if your pnpm version prefers it).
> 2. Create `/packages/_probe/package.json`:
>    ```json
>    {
>      "name": "@nest-auth-example/_probe",
>      "private": true,
>      "type": "module",
>      "version": "0.0.0",
>      "scripts": {
>        "typecheck": "tsc --noEmit -p tsconfig.json"
>      },
>      "dependencies": {
>        "@bymax-one/nest-auth": "workspace:*"
>      },
>      "devDependencies": {
>        "typescript": "^5.6.0"
>      }
>    }
>    ```
>    (If pnpm rejects `workspace:*` for a linked package, use the same `link:../../../nest-auth` form — ensure it resolves via the already-linked global.)
> 3. Create `/packages/_probe/tsconfig.json`:
>    ```json
>    {
>      "extends": "../../tsconfig.base.json",
>      "compilerOptions": {
>        "noEmit": true,
>        "rootDir": "src"
>      },
>      "include": ["src/**/*.ts"]
>    }
>    ```
> 4. Create `/packages/_probe/src/probe.ts`:
>
>    ```ts
>    // TEMPORARY — delete during Phase 3 (see docs/DEVELOPMENT_PLAN.md §Phase 3)
>    import type { BymaxAuthModuleOptions } from '@bymax-one/nest-auth';
>    import { AUTH_ERROR_CODES } from '@bymax-one/nest-auth/shared';
>    import type { AuthClientConfig } from '@bymax-one/nest-auth/client';
>    import type { AuthProviderProps } from '@bymax-one/nest-auth/react';
>    import type { AuthProxyConfig } from '@bymax-one/nest-auth/nextjs';
>
>    // Prevent "unused import" diagnostics — this file exists only to prove
>    // that every subpath resolves with full types.
>    export const _probe = {
>      options: null as BymaxAuthModuleOptions | null,
>      codes: AUTH_ERROR_CODES,
>      client: null as AuthClientConfig | null,
>      react: null as AuthProviderProps | null,
>      next: null as AuthProxyConfig | null,
>    } as const;
>    ```
>
>    If any named import above does not exist in the current `@bymax-one/nest-auth` version, substitute the closest exported symbol from that subpath — the goal is one import per subpath, not specific symbols.
>
> 5. Run `pnpm install` to register the new workspace package.
>    Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 + Phase 2.
> - Do NOT add TypeScript path aliases; `node_modules` resolution must do the work.
> - The probe must be a workspace package so `pnpm -r run typecheck` picks it up.
>   Verification:
> - `node -p "require.resolve('@bymax-one/nest-auth')"` — expected: absolute path under `../nest-auth`.
> - `pnpm -r run typecheck` — expected: exit 0 with the probe's `typecheck` script succeeding.

### Completion Protocol

1. ✅ Edit this task's `Status` line → `🟢 Done`.
2. ✅ Tick every box in **Acceptance Criteria**.
3. ✅ Update this task's row in the **Task index**.
4. ✅ Increment the **Progress** counter in the file header.
5. ✅ Update the matching row in [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) (Done / Total, %, Status).
6. ✅ Recompute "Overall progress" in `DEVELOPMENT_PLAN.md` (sum / 126).
7. ✅ Append `- P2-3 ✅ YYYY-MM-DD — <one-line summary>` to **Completion log**.

If phase reaches 100%, switch its row status in `DEVELOPMENT_PLAN.md` to 🟢.

⚠️ Never mark done with failing verification.

---

## P2-4 — Verification: `pnpm typecheck` Passes; Probe Cleanup Flagged for Phase 3

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** XS (<30 min)
- **Depends on:** `P2-1`, `P2-2`, `P2-3`

### Description

Gate task for Phase 2 DoD: with the link + probe wired, `pnpm typecheck` at the repo root must exit 0. Also file a tracked follow-up reminding Phase 3 to delete the probe (per `DEVELOPMENT_PLAN.md` §Phase 3 "Delete the Phase 2 probe file").

### Acceptance Criteria

- [x] `pnpm typecheck` exits 0.
- [x] `scripts/link-library.sh --dry-run` or plain `./scripts/link-library.sh` completes cleanly on a machine with `../nest-auth` present.
- [x] A follow-up reminder is captured: entry added in `CHANGELOG.md` under `[Unreleased]`: "Phase 3 follow-up: delete `packages/_probe` (introduced by Phase 2; verifies subpath typings)."
- [x] Running `pnpm --filter @nest-auth-example/_probe run typecheck` exits 0.

### Files to create / modify

- `CHANGELOG.md` — add the follow-up note under `[Unreleased]`.

### Agent Execution Prompt

> Role: Senior TypeScript / NestJS engineer.
> Context: Task P2-4 of `docs/DEVELOPMENT_PLAN.md` §Phase 2. Phase DoD: `pnpm typecheck` green with the probe; Phase 3 will delete the probe.
> Objective: Run the final verification and flag the probe cleanup as a Phase 3 follow-up.
> Steps:
>
> 1. Run `pnpm -r run typecheck` and confirm exit 0.
> 2. Edit `/CHANGELOG.md` — under `## [Unreleased]` add a bullet to an `### Added` or `### Notes` subsection:
>    `- Phase 3 follow-up: delete packages/_probe (introduced by Phase 2; verifies subpath typings).`
> 3. In this task's Completion log entry (step 7 of Completion Protocol), reference the CHANGELOG line and the `DEVELOPMENT_PLAN.md` §Phase 3 bullet that says "Delete the Phase 2 probe file".
>    Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 + Phase 2.
> - Do NOT delete the probe here — Phase 3 owns that cleanup.
>   Verification:
> - `pnpm -r run typecheck` — expected: exit 0.
> - `grep -q "delete packages/_probe" CHANGELOG.md` — expected: match.

### Completion Protocol

1. ✅ Edit this task's `Status` line → `🟢 Done`.
2. ✅ Tick every box in **Acceptance Criteria**.
3. ✅ Update this task's row in the **Task index**.
4. ✅ Increment the **Progress** counter in the file header.
5. ✅ Update the matching row in [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) (Done / Total, %, Status).
6. ✅ Recompute "Overall progress" in `DEVELOPMENT_PLAN.md` (sum / 126).
7. ✅ Append `- P2-4 ✅ YYYY-MM-DD — <one-line summary>` to **Completion log**.

If phase reaches 100%, switch its row status in `DEVELOPMENT_PLAN.md` to 🟢.

⚠️ Never mark done with failing verification.

---

## Completion log

- P2-1 ✅ 2026-04-19 — Created `scripts/link-library.sh`: builds `../nest-auth`, registers global link, links into workspace, prints resolved path.
- P2-2 ✅ 2026-04-19 — Created `scripts/unlink-library.sh`: reverses global link with `|| true` for idempotency, prints restore reminder.
- P2-3 ✅ 2026-04-19 — Added `"@bymax-one/nest-auth": "link:../nest-auth"` to root `package.json`; created `packages/_probe` workspace with probe.ts importing one symbol from all 5 library subpaths; `pnpm install` confirmed link resolves to `../nest-auth/dist/server/index.cjs`.
- P2-4 ✅ 2026-04-19 — `pnpm -r --if-present run typecheck` exits 0; Phase 3 follow-up captured in CHANGELOG.md under [Unreleased]; added stub tsconfigs (`files:[]`) for apps/api and apps/web so typecheck passes before Phase 3 bootstrap.
