# Contributing

Thank you for your interest in contributing to `nest-auth-example`.

## Getting started

Read [docs/OVERVIEW.md §16 — Contributing](docs/OVERVIEW.md#16-contributing) for the full guide on how to propose changes, open issues, and submit pull requests.

## Commit style

All commits must follow **Conventional Commits** (e.g. `feat:`, `fix:`, `chore:`). This is enforced automatically by `commitlint` via the Husky `commit-msg` hook installed in Phase 0.

## CI requirements

Every pull request must pass:

- `pnpm lint` — ESLint v10 flat config
- `pnpm typecheck` — TypeScript strict mode
- `pnpm test` — unit tests
- `pnpm test:e2e` — integration tests (requires Docker services)

See [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) for the full build roadmap.
