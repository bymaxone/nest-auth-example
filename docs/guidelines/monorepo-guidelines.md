# Monorepo Guidelines

pnpm workspaces + a thin root orchestrator. Two runtime packages (`apps/api`, `apps/web`), zero shared runtime libraries — yet.

- **Package manager**: pnpm `^10.8` (`packageManager: "pnpm@10.8.0"` in `package.json`)
- **Node**: `>=24` (enforced in every `package.json` via `engines`)
- **Workspace file**: `pnpm-workspace.yaml`
- **Official docs**: https://pnpm.io/workspaces

---

## When to read this

Before adding a new package, changing a root script, linking a sibling package, adding a dependency in a workspace, or running tasks across packages.

---

## Layout

```
nest-auth-example/
├── apps/
│   ├── api/         NestJS 11
│   └── web/         Next.js 16
├── packages/        (reserved; empty today)
├── pnpm-workspace.yaml
└── package.json     root, private, orchestrator
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

---

## Rules

1. **Root is private.** `"private": true` — never published to npm.
2. **Root has no runtime dependencies.** Only tooling (`eslint`, `prettier`, `husky`, `lint-staged`, `commitlint`, `typescript`). Every runtime dep lives in the owning workspace.
3. **Node version pinned** in `.nvmrc` and `engines.node` of every package.
4. **pnpm version pinned** in `packageManager` + `engines.pnpm`.
5. **No "floating" versions.** Package versions use `^` or exact; never `latest`.
6. **Cross-workspace imports go through the workspace protocol** (`workspace:*`) — not relative paths.
7. **One lockfile.** `pnpm-lock.yaml` at the repo root. Never commit per-package lockfiles.

---

## Dependencies

Install into the correct workspace using `--filter`:

```bash
# Runtime dep in apps/api
pnpm --filter @nest-auth-example/api add pino

# Dev dep in apps/web
pnpm --filter @nest-auth-example/web add -D @testing-library/react

# Dev tooling at the root (rare)
pnpm add -Dw eslint
```

Rules:

- **Never `pnpm add` without `--filter`** unless the dep is a root-only dev tool (ESLint, Prettier, Husky). The `-w` flag targets the root explicitly.
- **Respect `peerDependencies`** the library (`@bymax-one/nest-auth`) declares. Installing a conflicting major silently breaks typing.
- **Devtools in the consumer**: if only `apps/web` uses Vitest, it belongs there — not at the root. Keeps CI install graphs minimal.
- **No `pnpm install --shamefully-hoist`** — hides accidental unlisted deps.

### Shared config files

Single source at the root, re-exported or extended from each package:

- `tsconfig.base.json` ← each package extends
- `eslint.config.mjs` ← single flat config walks the whole tree
- `.prettierrc.mjs` ← single root file
- `commitlint.config.mjs` ← repo-level
- `lint-staged.config.mjs` ← repo-level

Never duplicate any of these inside a workspace.

---

## `@bymax-one/nest-auth` linking

Until the library is on npm, consume it via `pnpm link` from a sibling checkout. Covered in [OVERVIEW §7](../OVERVIEW.md) and [nest-auth-guidelines.md](nest-auth-guidelines.md). Key details:

- Both `apps/api/package.json` and `apps/web/package.json` reference the library as `"@bymax-one/nest-auth": "link:../../nest-auth"`.
- `pnpm link --global @bymax-one/nest-auth` creates the global link after `pnpm build` in the library repo.
- Once the library publishes, switch to `"@bymax-one/nest-auth": "^1.0.0"` and drop the link.

---

## Running tasks across packages

Root scripts fan out with `-r` or `--filter`:

```json
{
  "scripts": {
    "dev": "pnpm -r --parallel --if-present run dev",
    "build": "pnpm -r --if-present run build",
    "typecheck": "pnpm -r --if-present run typecheck",
    "test": "pnpm -r --if-present run test",
    "lint": "eslint ."
  }
}
```

- **`-r`** = recursive (every package in the workspace).
- **`--parallel`** only for `dev` — build/test run topologically in dependency order otherwise.
- **`--if-present`** — skips packages that don't define the script.
- **ESLint runs from the root**, walks the whole workspace (`eslint.config.mjs` handles ignores).

### Running against one package

```bash
pnpm --filter @nest-auth-example/api run dev
pnpm --filter @nest-auth-example/web run test -- --watch
pnpm -F @nest-auth-example/api run prisma:migrate
```

`-F` and `--filter` are interchangeable.

---

## Adding a new package

Rare for this project; likely candidates: shared `@nest-auth-example/shared` (types, error codes), `@nest-auth-example/email-templates`.

1. `mkdir packages/<name> && cd packages/<name>`
2. `pnpm init` → set `"name": "@nest-auth-example/<name>"`, `"private": true`, `"type": "module"`, `"engines"`, `"packageManager"` inherited from root.
3. Add `tsconfig.json` that extends `../../tsconfig.base.json`.
4. Publish to consumers via `pnpm --filter @nest-auth-example/<consumer> add @nest-auth-example/<name>@workspace:*`.
5. Document the new package in this file's "Layout" section.

Keep packages small and purpose-built. A "utils" grab-bag package is an anti-pattern — prefer one package per concern.

---

## Caching

pnpm's content-addressable store already caches per version. Nothing to configure.

For CI:

- Cache `~/.pnpm-store` (keyed by `pnpm-lock.yaml`).
- Cache `node_modules/.cache` per workspace if a builder uses it (Next.js, Playwright).
- Do not cache `node_modules` itself — it's a symlink farm; restoring it is slower than `pnpm install`.

---

## Publishing

- None. Root is `"private": true`, workspaces are `"private": true`. If a workspace ever publishes, remove its `private` flag explicitly and add `publishConfig` — never flip the root.

---

## Common pitfalls

1. **`npm install` or `yarn install`** — generates a different lockfile, corrupts the pnpm store. Pre-commit hook blocks it.
2. **Dependency installed at the root for a single workspace** — slows installs, bloats hoisting. Move to the owning package.
3. **Two packages with the same script name doing different things** — use scoped names (`db:migrate`, `api:db:migrate`) when meanings diverge.
4. **Accidentally committing per-package lockfiles** — `.gitignore` should include `apps/*/pnpm-lock.yaml`.
5. **`pnpm update` without `--filter`** — touches every package, bloats the diff, and re-links the library. Always target.
6. **Version drift between packages** — the same dep pinned to different versions (React 19.1 vs 19.2) wastes time in CI. Use `pnpm dedupe` before merging.
7. **`workspace:*` missing** when referencing a sibling — publishes `link:` into a consumer, fails outside the monorepo.

---

## References

- pnpm docs: https://pnpm.io
- pnpm workspaces: https://pnpm.io/workspaces
- Node 24 release notes: https://nodejs.org/en/blog/
- Project root: `package.json`, `pnpm-workspace.yaml`
