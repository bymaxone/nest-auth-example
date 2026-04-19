# Guidelines

Development conventions for `nest-auth-example`. Authored for humans **and** AI coding agents. Read **on demand**, before touching the relevant area of code.

**Never open all of these at once.** Each file answers one question: _How should I work with X in this project?_ Pick the one that matches your task.

For the quick-reference, start at [../../CLAUDE.md](../../CLAUDE.md). For the full spec, see [../../AGENTS.md](../../AGENTS.md).

---

## Stack guidelines (one per area)

Open only what you need.

| Guideline                                            | When to open                                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [nestjs-guidelines.md](nestjs-guidelines.md)         | Before modifying `apps/api/src/*`: modules, controllers, services, guards, `main.ts`                                                  |
| [prisma-guidelines.md](prisma-guidelines.md)         | Before any schema change, query, migration, seed, or repository implementation                                                        |
| [postgres-guidelines.md](postgres-guidelines.md)     | Before adding an index, writing raw SQL, or profiling a slow query                                                                    |
| [redis-guidelines.md](redis-guidelines.md)           | Before opening a Redis connection, designing a key, or setting a TTL                                                                  |
| [nextjs-guidelines.md](nextjs-guidelines.md)         | Before editing anything under `apps/web/app/`, `proxy.ts`, or a `route.ts`                                                            |
| [react-guidelines.md](react-guidelines.md)           | Before any React component, hook, context, or client/server boundary change                                                           |
| [tailwind-guidelines.md](tailwind-guidelines.md)     | Before writing `className`, adding a token, or using shadcn/ui primitives                                                             |
| [typescript-guidelines.md](typescript-guidelines.md) | Before typing anything non-trivial or touching `tsconfig.*`                                                                           |
| [forms-guidelines.md](forms-guidelines.md)           | Before any form using React Hook Form + Zod                                                                                           |
| [validation-guidelines.md](validation-guidelines.md) | Before accepting external input anywhere (DTO, env, form, route handler)                                                              |
| [logging-guidelines.md](logging-guidelines.md)       | Before emitting a log, configuring Pino, or shipping logs anywhere                                                                    |
| [email-guidelines.md](email-guidelines.md)           | Before adding an email template, switching a provider, or designing a sender                                                          |
| [nest-auth-guidelines.md](nest-auth-guidelines.md)   | Before wiring `BymaxAuthModule`, implementing `IUserRepository` / `IEmailProvider` / `IAuthHooks`, or using library guards/decorators |
| [testing-guidelines.md](testing-guidelines.md)       | Before writing any test — Jest + supertest, Vitest, or Playwright                                                                     |
| [docker-guidelines.md](docker-guidelines.md)         | Before editing Compose files, images, volumes, or Docker configs                                                                      |

## Cross-cutting guidelines

| Guideline                                                        | When to open                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [monorepo-guidelines.md](monorepo-guidelines.md)                 | Adding a package, changing root scripts, linking sibling packages         |
| [environment-guidelines.md](environment-guidelines.md)           | Adding, renaming, or removing an env var; changing `.env.example`         |
| [observability-guidelines.md](observability-guidelines.md)       | Writing an audit event, defining a metric, or touching `/health`          |
| [security-privacy-guidelines.md](security-privacy-guidelines.md) | Before any code near auth, user data, cookies, CORS, secrets, CSP         |
| [lint-format-guidelines.md](lint-format-guidelines.md)           | Editing ESLint, Prettier, Husky, lint-staged, or commitlint configuration |

## Workflow guidelines

| Guideline                            | When to open                                                              |
| ------------------------------------ | ------------------------------------------------------------------------- |
| [coding-style.md](coding-style.md)   | Codebase style + **mandatory code documentation policy**                  |
| [git-workflow.md](git-workflow.md)   | Branches, commits, PRs, reverts — and the "no commit/push by agents" rule |
| [pr-review.md](pr-review.md)         | Before approving or closing a PR                                          |
| [agent-handoff.md](agent-handoff.md) | Before dispatching a task to another AI agent                             |

---

## Principles that cut across every guideline

1. **Copy-paste friendly.** Every file a consumer might lift into their own app should work after changing env vars only.
2. **Strict typing.** Zero `any`, zero suppressions. Errors at compile, not runtime.
3. **Security-first defaults.** Cookies HttpOnly, CORS allowlisted, validation on every boundary, secrets validated at boot.
4. **Multi-tenant by construction.** `tenantId` on every user-facing row; resolved once per request via `X-Tenant-Id`.
5. **Library-faithful.** `@bymax-one/nest-auth` exports are used as-shipped; no reshaping, no re-implementing.
6. **Observable.** Structured Pino logs + append-only `audit_logs` + reachable `/health`.
7. **Documented by default.** File-header JSDoc, exports with JSDoc, inline "why" comments, scenario comments on every test `it`.

Changes to any of these → ADR in `docs/decisions/` (folder to be created when the first ADR lands).

---

## How agents use this folder

- **[CLAUDE.md](../../CLAUDE.md)** at the repo root is the quick-reference. Always skim before a task.
- **[AGENTS.md](../../AGENTS.md)** at the repo root is the full spec. Open for non-trivial work.
- **This folder** contains the domain-specific deep-dives. Open **only** what the current task touches.

The goal: high signal per file, low duplication, loaded on demand.

---

## Adding a new guideline

If a new pattern emerges that spans more than one PR:

1. Name it `<topic>-guidelines.md` (lowercase, kebab-case, ending in `-guidelines.md`). Exception: workflow files keep their simpler names (`coding-style.md`, `git-workflow.md`, `pr-review.md`, `agent-handoff.md`).
2. Structure it like the existing files:
   - What library/version.
   - "When to read this".
   - Setup / what's already done.
   - Rules with examples.
   - Common pitfalls.
   - References.
3. Add an entry in this README under the right table.
4. Link it from `../../AGENTS.md` → "Reference documentation".
5. Never dump docs into `docs/` root or into a module folder. Agent guidelines live here.
