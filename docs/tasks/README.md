# Tasks — nest-auth-example

> Jira-style task dashboard for the phased development of `nest-auth-example`.
> Source plan: [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md).
> Progress dashboard: [`../DEVELOPMENT_PLAN.md#progress-summary`](../DEVELOPMENT_PLAN.md#progress-summary).

## Phase files

| Phase | File                                                                         | Scope                                                         |
| ----- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 0     | [phase-00-repo-foundation.md](./phase-00-repo-foundation.md)                 | pnpm workspace, tsconfig, eslint, prettier, husky, commitlint |
| 1     | [phase-01-docker-infra.md](./phase-01-docker-infra.md)                       | Postgres, Redis, Mailpit via docker-compose                   |
| 2     | [phase-02-library-linking.md](./phase-02-library-linking.md)                 | Link `@bymax-one/nest-auth` from `../nest-auth`               |
| 3     | [phase-03-api-skeleton.md](./phase-03-api-skeleton.md)                       | NestJS 11 boot, Pino logger, `/api/health`                    |
| 4     | [phase-04-prisma-schema.md](./phase-04-prisma-schema.md)                     | Prisma schema, migrations, seed                               |
| 5     | [phase-05-infra-modules.md](./phase-05-infra-modules.md)                     | Prisma/Redis/Health/Config NestJS modules                     |
| 6     | [phase-06-library-wiring.md](./phase-06-library-wiring.md)                   | `auth.config.ts`, repositories, email providers, hooks        |
| 7     | [phase-07-auth-module-demo-domain.md](./phase-07-auth-module-demo-domain.md) | `BymaxAuthModule.registerAsync`, tenants/projects demo        |
| 8     | [phase-08-oauth-invitations.md](./phase-08-oauth-invitations.md)             | Google OAuth, invitations end-to-end                          |
| 9     | [phase-09-platform-backend.md](./phase-09-platform-backend.md)               | Platform admin routes + module                                |
| 10    | [phase-10-websocket-backend.md](./phase-10-websocket-backend.md)             | `WsJwtGuard`, notifications gateway                           |
| 11    | [phase-11-web-skeleton.md](./phase-11-web-skeleton.md)                       | Next.js 16, Tailwind v4, shadcn/ui                            |
| 12    | [phase-12-frontend-auth-wiring.md](./phase-12-frontend-auth-wiring.md)       | `createAuthProxy`, handlers, client, provider                 |
| 13    | [phase-13-public-auth-pages.md](./phase-13-public-auth-pages.md)             | Login, register, MFA challenge, etc.                          |
| 14    | [phase-14-dashboard.md](./phase-14-dashboard.md)                             | Account, Security, Sessions, Team, Invitations, Projects      |
| 15    | [phase-15-platform-frontend.md](./phase-15-platform-frontend.md)             | Platform admin UI                                             |
| 16    | [phase-16-websocket-frontend.md](./phase-16-websocket-frontend.md)           | WebSocket client + notification toasts                        |
| 17    | [phase-17-testing.md](./phase-17-testing.md)                                 | Jest, supertest, Vitest, Playwright                           |
| 18    | [phase-18-documentation.md](./phase-18-documentation.md)                     | Every `docs/*.md` file                                        |
| 19    | [phase-19-cicd.md](./phase-19-cicd.md)                                       | GitHub Actions, Docker images, release workflow               |
| 20    | [phase-20-audit-hardening.md](./phase-20-audit-hardening.md)                 | Export-usage audit, security hardening, v1.0.0 tag            |

## Task-file conventions

Every per-phase file follows this structure:

1. **Header** — phase name, reference to `DEVELOPMENT_PLAN.md`, progress counter, status legend, and an index table of tasks.
2. **Task blocks** — one per actionable deliverable, each with:
   - `ID` (e.g., `P0-1`), `Status`, `Priority`, `Size`, `Depends on`.
   - `Description`, `Acceptance Criteria` (checkable), `Files to create / modify`.
   - `Agent Execution Prompt` — a detailed, self-contained brief for the executing AI agent.
   - `Completion Protocol` — exact steps the agent must take to mark the task done and update both the phase file and the global dashboard.
3. **Completion log** — appended by agents as tasks finish.

## Status legend

- 🔴 **Not Started** — ready to pick up (if dependencies are green).
- 🟡 **In Progress** — an agent is actively working on it; only one in-progress task per phase at a time.
- 🔵 **In Review** — implemented, awaiting human review.
- 🟢 **Done** — merged; criteria satisfied; dashboard updated.
- ⚪ **Blocked** — waiting on an external dependency; note the blocker in the task description.

## Execution order

Follow the dependency graph in `DEVELOPMENT_PLAN.md` §1. Within a phase, respect each task's `Depends on` field. Do not start a task until every dependency is 🟢.
