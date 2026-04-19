# Phase 3 — `apps/api` Skeleton (NestJS 11) — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-3--appsapi-skeleton-nestjs-11) §Phase 3
> **Total tasks:** 6
> **Progress:** 🔴 0 / 6 done (0%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID | Task | Status | Priority | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| P3-1 | `apps/api/package.json` + dependencies + scripts | 🔴 | High | M | Phase 2 |
| P3-2 | `apps/api/tsconfig.json` + `tsconfig.build.json` + `nest-cli.json` | 🔴 | High | S | `P3-1` |
| P3-3 | `apps/api/src/main.ts` bootstrap (pipes, cookies, prefix, pino, shutdown) | 🔴 | High | M | `P3-2` |
| P3-4 | `apps/api/src/app.module.ts` minimal skeleton | 🔴 | High | S | `P3-2` |
| P3-5 | `apps/api/src/health/` module + `GET /api/health` | 🔴 | High | S | `P3-4` |
| P3-6 | Boot verification + delete Phase 2 probe file | 🔴 | High | XS | `P3-3`, `P3-4`, `P3-5` |

---

## P3-1 — `apps/api/package.json` + dependencies + scripts

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** Phase 2 (library linked at workspace root)

### Description
Create the `apps/api` package manifest with the exact NestJS 11 / Express 5 runtime stack required by `@bymax-one/nest-auth`, wire the linked library as a workspace-global dep, and register the canonical script set used by every downstream phase (`dev`, `build`, `start`, `test`, `test:e2e`, `typecheck`, `lint`, `prisma:*`).

### Acceptance Criteria
- [ ] `apps/api/package.json` exists with `"type": "module"` and `"name": "@nest-auth-example/api"`.
- [ ] Runtime deps include (all pinned to caret major): `@nestjs/common@^11`, `@nestjs/core@^11`, `@nestjs/platform-express@^11`, `@nestjs/jwt@^11`, `@nestjs/throttler@^6`, `@nestjs/websockets@^11`, `express@^5`, `reflect-metadata@^0.2`, `rxjs@^7`, `cookie-parser`, `class-validator`, `class-transformer`, `ioredis@^5`, `@bymax-one/nest-auth` (linked), `@prisma/client@^6`, `pino`, `nestjs-pino`, `zod`, `dotenv-safe`.
- [ ] Dev deps include: `@nestjs/cli@^11`, `@nestjs/testing`, `@types/express@^5`, `@types/cookie-parser`, `@types/node`, `jest`, `supertest`, `ts-jest`, `ts-node`, `tsx`, `typescript`, `prisma@^6`.
- [ ] Scripts: `dev` → `nest start --watch`, `build` → `nest build`, `start` → `node dist/main.js`, `test` → `jest`, `test:e2e` → `jest --config test/jest-e2e.json`, `typecheck` → `tsc --noEmit`, `lint` → `eslint "src/**/*.ts"`, `prisma:generate`, `prisma:migrate`, `prisma:seed`, `prisma:studio`.
- [ ] `pnpm install` from the workspace root completes without unresolved peers; `@bymax-one/nest-auth` resolves to the linked sibling path.

### Files to create / modify
- `apps/api/package.json` — new file.

### Agent Execution Prompt

> Role: Senior NestJS engineer bootstrapping a new workspace package that consumes a linked peer library.
>
> Context: Phase 3 boots the API app on top of the work completed in Phase 2 (library linking). See `docs/DEVELOPMENT_PLAN.md` §Phase 3 for the full deliverables list. `@bymax-one/nest-auth` is available as a global pnpm link from `../nest-auth` and must be listed here as a dependency so the workspace picks it up.
>
> Objective: Produce a complete `apps/api/package.json` that pins the library-compatible versions of Nest 11, Express 5, and supporting libraries, and registers every script later phases rely on.
>
> Steps:
> 1. Create `apps/api/package.json` with `"type": "module"`, `"name": "@nest-auth-example/api"`, `"private": true`, `"version": "0.0.1"`.
> 2. Declare the dependency list exactly as enumerated in `DEVELOPMENT_PLAN.md` §Phase 3 (Nest 11 core + platform-express + jwt + throttler + websockets, Express 5, `cookie-parser`, `class-validator`, `class-transformer`, `ioredis@^5`, `@bymax-one/nest-auth`, `@prisma/client@^6`, `pino`, `nestjs-pino`, `zod`, `dotenv-safe`, `reflect-metadata`, `rxjs`).
> 3. Declare devDependencies for `@nestjs/cli@^11`, `@nestjs/testing`, Jest + supertest + ts-jest, `tsx`, `ts-node`, `typescript`, `prisma@^6`, and the relevant `@types/*` packages.
> 4. Add the full script roster (`dev`, `build`, `start`, `test`, `test:e2e`, `typecheck`, `lint`, `prisma:generate`, `prisma:migrate`, `prisma:seed`, `prisma:studio`).
> 5. Run `pnpm install` from the repo root and confirm the install is clean.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (ESM, pnpm 10, Node 24, strict TS).
> - Do not add `@nestjs/config` — this project uses a zod-based loader landed in Phase 5.
> - Do not add auth-specific code yet; Phases 6+ own that work.
>
> Verification:
> - `pnpm install` — expected: no peer-dep errors, `node_modules/@bymax-one/nest-auth` resolves to the linked path.
> - `pnpm --filter @nest-auth-example/api list @bymax-one/nest-auth` — expected: shows the linked version.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P3-1 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P3-2 — `apps/api/tsconfig.json` + `tsconfig.build.json` + `nest-cli.json`

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** S
- **Depends on:** `P3-1`

### Description
Provide the TypeScript configuration that supports ESM + strict mode + Nest CLI compilation. The base `tsconfig.json` extends the workspace root (set up in Phase 0); the build variant drives `nest build`; `nest-cli.json` points Nest CLI at the right `src` / `tsconfig.build.json`.

### Acceptance Criteria
- [ ] `apps/api/tsconfig.json` extends the workspace root tsconfig, sets `rootDir: "src"`, `outDir: "dist"`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `target: "ES2023"`, `experimentalDecorators: true`, `emitDecoratorMetadata: true`, `strict: true`, `skipLibCheck: true`, and includes `src/**/*` + `test/**/*`.
- [ ] `apps/api/tsconfig.build.json` extends `tsconfig.json`, excludes `node_modules`, `dist`, `test`, `**/*.spec.ts`, `**/*.e2e-spec.ts`.
- [ ] `apps/api/nest-cli.json` declares `"sourceRoot": "src"`, `"compilerOptions": { "tsConfigPath": "tsconfig.build.json", "deleteOutDir": true }`, and `"$schema"` pointing at `@nestjs/cli`.
- [ ] `pnpm --filter api typecheck` exits `0` on an empty `src/` stub.

### Files to create / modify
- `apps/api/tsconfig.json` — new file.
- `apps/api/tsconfig.build.json` — new file.
- `apps/api/nest-cli.json` — new file.

### Agent Execution Prompt

> Role: TypeScript / NestJS engineer wiring strict ESM TypeScript for a workspace package.
>
> Context: The workspace root (Phase 0) defines a base tsconfig with the shared compiler options; `apps/api` extends it. Nest CLI needs its own build tsconfig because we exclude tests from emitted output.
>
> Objective: Create the three config files so `nest build` and `tsc --noEmit` both succeed.
>
> Steps:
> 1. Create `apps/api/tsconfig.json` extending the workspace base; set `rootDir`, `outDir`, `module: NodeNext`, `moduleResolution: NodeNext`, `target: ES2023`, `strict: true`, `experimentalDecorators: true`, `emitDecoratorMetadata: true`.
> 2. Create `apps/api/tsconfig.build.json` that extends the file above and excludes tests + build output.
> 3. Create `apps/api/nest-cli.json` pointing Nest CLI at `src` + `tsconfig.build.json`.
> 4. Drop a placeholder `apps/api/src/main.ts` (empty export) so `typecheck` has something to analyze.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (ESM, strict TS, pnpm 10, Node 24).
> - Do not introduce path aliases at this phase — they complicate library resolution and are not needed.
> - Keep `skipLibCheck: true` to keep cold compilation fast against the linked library's types.
>
> Verification:
> - `pnpm --filter api typecheck` — expected: exit 0, no type errors.
> - `pnpm --filter api build` — expected: emits `dist/` with no errors (using the placeholder file).

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P3-2 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P3-3 — `apps/api/src/main.ts` bootstrap (pipes, cookies, prefix, pino, shutdown)

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** M
- **Depends on:** `P3-2`

### Description
Implement the NestJS bootstrap entry point with the exact concerns required by `@bymax-one/nest-auth`: Express 5 adapter, global `ValidationPipe` (whitelist + transform), `cookie-parser` middleware, `setGlobalPrefix('api')`, structured pino logging via `nestjs-pino`, and graceful shutdown hooks. Domain routes will live under `/api/*`; the library's own `routePrefix: 'auth'` combined with this prefix yields `/api/auth/*`.

### Acceptance Criteria
- [ ] `apps/api/src/main.ts` uses `NestFactory.create(AppModule, new ExpressAdapter(), { bufferLogs: true })`.
- [ ] `app.useLogger(app.get(Logger))` wires `nestjs-pino` as the global logger.
- [ ] `app.use(cookieParser())` is called before `setGlobalPrefix`.
- [ ] `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }))` is registered.
- [ ] `app.setGlobalPrefix('api')` is applied so `/api/health`, `/api/auth/*`, etc. are the canonical URLs.
- [ ] `app.enableShutdownHooks()` is called before `app.listen`.
- [ ] Port is read via `process.env.API_PORT ?? 4000`; log a single `"API listening on :<port>"` line on boot.
- [ ] `NODE_OPTIONS=--enable-source-maps` compatible — `main.ts` imports `reflect-metadata` at the top.

### Files to create / modify
- `apps/api/src/main.ts` — rewrite placeholder to the real bootstrap.

### Agent Execution Prompt

> Role: Senior NestJS engineer wiring a production-grade bootstrap.
>
> Context: This is the canonical entry point for `@nest-auth-example/api`. It must match the library's expectations (cookie-based token delivery, Express 5 adapter, global `/api` prefix) so subsequent phases can mount `BymaxAuthModule` without further changes to `main.ts`. See `docs/DEVELOPMENT_PLAN.md` §Phase 3.
>
> Objective: Replace the placeholder `main.ts` with a complete bootstrap that loads `AppModule`, wires pino logging, the global validation pipe, cookie parsing, the `/api` prefix, and shutdown hooks.
>
> Steps:
> 1. `import 'reflect-metadata'` on the very first line.
> 2. Build `AppModule` via `NestFactory.create(AppModule, new ExpressAdapter(), { bufferLogs: true })`.
> 3. Resolve `Logger` from `nestjs-pino` and install it via `app.useLogger(logger)`.
> 4. Register `cookie-parser` middleware, then `setGlobalPrefix('api')`.
> 5. Install `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`.
> 6. Call `app.enableShutdownHooks()`.
> 7. Listen on `process.env.API_PORT ?? 4000`; log a single startup line via the pino logger.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (ESM, strict TS, Node 24).
> - Do NOT call `app.enableCors()` here — CORS is negotiated via the Next.js proxy in Phase 12.
> - Do NOT hardcode secrets; env parsing is Phase 5's responsibility.
>
> Verification:
> - `pnpm --filter api build` — expected: emits `dist/main.js` with no errors.
> - `pnpm --filter api dev` — expected: process starts and logs `API listening on :4000` (will fail health route until P3-5 lands, which is fine here).

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P3-3 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P3-4 — `apps/api/src/app.module.ts` minimal skeleton

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** S
- **Depends on:** `P3-2`

### Description
Ship the smallest possible `AppModule` that boots: imports exactly `HealthModule` and `LoggerModule` (from `nestjs-pino`). Later phases (5, 6, 7) layer in Config, Prisma, Redis, and `BymaxAuthModule` without disturbing this shape.

### Acceptance Criteria
- [ ] `apps/api/src/app.module.ts` exports `AppModule` decorated with `@Module({ imports: [...], controllers: [], providers: [] })`.
- [ ] The `imports` array contains **only** `LoggerModule.forRoot({ ... })` (see prompt for options) and `HealthModule`.
- [ ] No direct references to Prisma, Redis, Config, or `BymaxAuthModule` at this phase — those land in later phases.
- [ ] `nestjs-pino` config sets `transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' }`.
- [ ] `pnpm --filter api build` succeeds.

### Files to create / modify
- `apps/api/src/app.module.ts` — new file.

### Agent Execution Prompt

> Role: NestJS engineer composing a root module for a layered codebase.
>
> Context: The project grows by phase — `AppModule` starts minimal and later phases add modules without rewriting it. At this phase only health + logging exist.
>
> Objective: Produce a minimal `AppModule` that wires pino via `nestjs-pino` and mounts `HealthModule`.
>
> Steps:
> 1. Create `apps/api/src/app.module.ts`.
> 2. Import `LoggerModule` from `nestjs-pino` and register it with `forRoot({ pinoHttp: { level: process.env.LOG_LEVEL ?? 'info', transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' } } })`.
> 3. Import `HealthModule` from `./health/health.module.js` (created in P3-5; an agent running tasks serially will have it, otherwise a temporary stub is acceptable).
> 4. Decorate the exported class with `@Module({ imports: [LoggerModule.forRoot(...), HealthModule], controllers: [], providers: [] })`.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (ESM, strict TS).
> - Do not import `@nestjs/config`, Prisma, Redis, or the auth library yet.
> - Use `.js` extensions in imports (ESM / NodeNext requirement).
>
> Verification:
> - `pnpm --filter api typecheck` — expected: green.
> - `pnpm --filter api build` — expected: clean emit.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P3-4 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P3-5 — `apps/api/src/health/` module + `GET /api/health`

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** S
- **Depends on:** `P3-4`

### Description
Implement the first real route: `GET /api/health` returns `{ status: 'ok', uptime, version }`. At this phase the endpoint is in-process only — no Postgres or Redis checks (those are added in Phase 5). `version` is read from the `apps/api` `package.json`.

### Acceptance Criteria
- [ ] `apps/api/src/health/health.module.ts` declares `HealthController`.
- [ ] `apps/api/src/health/health.controller.ts` exposes `@Controller('health')` + `@Get()` that returns `{ status: 'ok', uptime: process.uptime(), version: <pkg.version> }`.
- [ ] Response shape is typed via a small interface `HealthStatus` in a shared `.ts` file; no `any`.
- [ ] With the Nest global prefix, the endpoint lives at `GET /api/health` — verified by curl after boot.
- [ ] Returns HTTP 200, JSON content type.

### Files to create / modify
- `apps/api/src/health/health.module.ts` — new file.
- `apps/api/src/health/health.controller.ts` — new file.

### Agent Execution Prompt

> Role: NestJS engineer shipping the first feature module for a fresh codebase.
>
> Context: Phase 3 only needs a trivial health route to prove the server boots and the `/api` prefix is correctly applied. Phase 5 upgrades this endpoint to aggregate Postgres + Redis + library version.
>
> Objective: Create a minimal `HealthModule` + `HealthController` that returns `{ status, uptime, version }` at `GET /api/health`.
>
> Steps:
> 1. Create `apps/api/src/health/health.controller.ts` with `@Controller('health')` and a single `@Get()` method.
> 2. Read `version` by importing the `package.json` via `import pkg from '../../package.json' with { type: 'json' }` (ESM JSON import attributes) OR by reading it once at module load time with `readFileSync` — pick whichever passes typecheck.
> 3. Return `{ status: 'ok', uptime: process.uptime(), version: pkg.version }`.
> 4. Create `apps/api/src/health/health.module.ts` with `@Module({ controllers: [HealthController] })`.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (ESM, strict TS).
> - Do not inject Prisma or Redis at this phase — Phase 5 upgrades the controller.
> - No `any` types; define a `HealthStatus` interface if needed.
>
> Verification:
> - `pnpm --filter api dev` — expected: boots.
> - `curl -s http://localhost:4000/api/health | jq` — expected: `{ "status": "ok", "uptime": <number>, "version": "0.0.1" }`.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P3-5 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P3-6 — Boot verification + delete Phase 2 probe file

- **Status:** 🔴 Not Started
- **Priority:** High
- **Size:** XS
- **Depends on:** `P3-3`, `P3-4`, `P3-5`

### Description
Verify the end-to-end Phase 3 "definition of done" from `DEVELOPMENT_PLAN.md`: `pnpm --filter @nest-auth-example/api dev` serves `GET http://localhost:4000/api/health` with HTTP 200. Then remove the Phase 2 probe file (`apps/api/src/auth/_probe.ts`) that validated library subpath typings — it is no longer required now that the real `AppModule` boots.

### Acceptance Criteria
- [ ] `pnpm --filter @nest-auth-example/api dev` boots cleanly on port 4000 with no runtime errors.
- [ ] `curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/health` prints `200`.
- [ ] Response JSON includes `status`, `uptime`, `version` keys.
- [ ] `apps/api/src/auth/_probe.ts` no longer exists; the parent `apps/api/src/auth/` directory is removed if it becomes empty (it will be recreated in Phase 6).
- [ ] `pnpm --filter api typecheck` passes after the deletion.

### Files to create / modify
- `apps/api/src/auth/_probe.ts` — DELETE.
- `apps/api/src/auth/` — delete if empty after probe removal.

### Agent Execution Prompt

> Role: NestJS engineer doing Phase 3 cleanup and release-gating verification.
>
> Context: Phase 2 seeded a temporary probe file to prove the library's subpath exports type-check. With a real `AppModule` booting in Phase 3 that probe is redundant. Phase 6 will re-create `apps/api/src/auth/` with real code.
>
> Objective: Confirm the API boots + serves `/api/health`, then delete the Phase 2 probe file (and the now-empty `auth/` folder).
>
> Steps:
> 1. Run `pnpm --filter @nest-auth-example/api dev` in one shell.
> 2. In a second shell, `curl -i http://localhost:4000/api/health` and confirm `HTTP/1.1 200` with JSON body `{ status, uptime, version }`.
> 3. Stop the dev server.
> 4. `git rm apps/api/src/auth/_probe.ts`; if the directory is empty, `rmdir apps/api/src/auth`.
> 5. `pnpm --filter api typecheck` to confirm nothing else referenced the probe.
>
> Constraints:
> - Follow `docs/DEVELOPMENT_PLAN.md` §2.
> - Do NOT keep the probe "just in case" — Phase 6 re-populates `auth/`.
> - Do NOT create any new files in this task.
>
> Verification:
> - `curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/health` — expected: `200`.
> - `test ! -f apps/api/src/auth/_probe.ts && echo OK` — expected: `OK`.
> - `pnpm --filter api typecheck` — expected: exit 0.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P3-6 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## Completion log
