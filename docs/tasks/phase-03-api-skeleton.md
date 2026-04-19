# Phase 3 — `apps/api` Skeleton (NestJS 11) — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-3--appsapi-skeleton-nestjs-11) §Phase 3
> **Total tasks:** 6
> **Progress:** 🟢 6 / 6 done (100%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID   | Task                                                                      | Status | Priority | Size | Depends on             |
| ---- | ------------------------------------------------------------------------- | ------ | -------- | ---- | ---------------------- |
| P3-1 | `apps/api/package.json` + dependencies + scripts                          | 🟢     | High     | M    | Phase 2                |
| P3-2 | `apps/api/tsconfig.json` + `tsconfig.build.json` + `nest-cli.json`        | 🟢     | High     | S    | `P3-1`                 |
| P3-3 | `apps/api/src/main.ts` bootstrap (pipes, cookies, prefix, pino, shutdown) | 🟢     | High     | M    | `P3-2`                 |
| P3-4 | `apps/api/src/app.module.ts` minimal skeleton                             | 🟢     | High     | S    | `P3-2`                 |
| P3-5 | `apps/api/src/health/` module + `GET /api/health`                         | 🟢     | High     | S    | `P3-4`                 |
| P3-6 | Boot verification + delete Phase 2 probe file                             | 🟢     | High     | XS   | `P3-3`, `P3-4`, `P3-5` |

---

## P3-1 — `apps/api/package.json` + dependencies + scripts

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** M
- **Depends on:** Phase 2 (library linked at workspace root)

### Description

Create the `apps/api` package manifest with the exact NestJS 11 / Express 5 runtime stack required by `@bymax-one/nest-auth`, wire the linked library as a workspace-global dep, and register the canonical script set used by every downstream phase (`dev`, `build`, `start`, `test`, `test:e2e`, `typecheck`, `lint`, `prisma:*`).

### Acceptance Criteria

- [x] `apps/api/package.json` exists with `"type": "module"` and `"name": "@nest-auth-example/api"`.
- [x] Runtime deps include (all pinned to caret major): `@nestjs/common@^11`, `@nestjs/core@^11`, `@nestjs/platform-express@^11`, `@nestjs/jwt@^11`, `@nestjs/throttler@^6`, `@nestjs/websockets@^11`, `express@^5`, `reflect-metadata@^0.2`, `rxjs@^7`, `cookie-parser`, `class-validator`, `class-transformer`, `ioredis@^5`, `@bymax-one/nest-auth` (linked), `@prisma/client@^6`, `pino`, `nestjs-pino`, `zod`, `dotenv-safe`.
- [x] Dev deps include: `@nestjs/cli@^11`, `@nestjs/testing`, `@types/express@^5`, `@types/cookie-parser`, `@types/node`, `jest`, `supertest`, `ts-jest`, `ts-node`, `tsx`, `typescript`, `prisma@^6`.
- [x] Scripts: `dev` → `nest start --watch`, `build` → `nest build`, `start` → `node dist/main.js`, `test` → `jest`, `test:e2e` → `jest --config test/jest-e2e.json`, `typecheck` → `tsc --noEmit`, `lint` → `eslint "src/**/*.ts"`, `prisma:generate`, `prisma:migrate`, `prisma:seed`, `prisma:studio`.
- [x] `pnpm install` from the workspace root completes without unresolved peers; `@bymax-one/nest-auth` resolves to the linked sibling path.

### Files to create / modify

- `apps/api/package.json` — updated scripts and added `pino-pretty` devDep.

---

## P3-2 — `apps/api/tsconfig.json` + `tsconfig.build.json` + `nest-cli.json`

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S
- **Depends on:** `P3-1`

### Description

Provide the TypeScript configuration that supports ESM + strict mode + Nest CLI compilation. The base `tsconfig.json` extends the workspace root (set up in Phase 0); the build variant drives `nest build`; `nest-cli.json` points Nest CLI at the right `src` / `tsconfig.build.json`.

### Acceptance Criteria

- [x] `apps/api/tsconfig.json` extends the workspace root tsconfig, sets `rootDir: "src"`, `outDir: "dist"`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `target: "ES2023"`, `experimentalDecorators: true`, `emitDecoratorMetadata: true`, `strict: true`, `skipLibCheck: true`, and includes `src/**/*` + `test/**/*`.
- [x] `apps/api/tsconfig.build.json` extends `tsconfig.json`, excludes `node_modules`, `dist`, `test`, `**/*.spec.ts`, `**/*.e2e-spec.ts`.
- [x] `apps/api/nest-cli.json` declares `"sourceRoot": "src"`, `"compilerOptions": { "tsConfigPath": "tsconfig.build.json", "deleteOutDir": true }`, and `"$schema"` pointing at `@nestjs/cli`.
- [x] `pnpm --filter api typecheck` exits `0` on an empty `src/` stub.

### Files to create / modify

- `apps/api/tsconfig.json` — replaced stub.
- `apps/api/tsconfig.build.json` — new file.
- `apps/api/nest-cli.json` — new file.

---

## P3-3 — `apps/api/src/main.ts` bootstrap (pipes, cookies, prefix, pino, shutdown)

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** M
- **Depends on:** `P3-2`

### Description

Implement the NestJS bootstrap entry point with the exact concerns required by `@bymax-one/nest-auth`: Express 5 adapter, global `ValidationPipe` (whitelist + transform), `cookie-parser` middleware, `setGlobalPrefix('api')`, structured pino logging via `nestjs-pino`, and graceful shutdown hooks.

### Acceptance Criteria

- [x] `apps/api/src/main.ts` uses `NestFactory.create(AppModule, new ExpressAdapter(), { bufferLogs: true })`.
- [x] `app.useLogger(app.get(Logger))` wires `nestjs-pino` as the global logger.
- [x] `app.use(cookieParser())` is called before `setGlobalPrefix`.
- [x] `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }))` is registered.
- [x] `app.setGlobalPrefix('api')` is applied so `/api/health`, `/api/auth/*`, etc. are the canonical URLs.
- [x] `app.enableShutdownHooks()` is called before `app.listen`.
- [x] Port is read via `process.env.API_PORT ?? 4000`; log a single `"API listening on :<port>"` line on boot.
- [x] `NODE_OPTIONS=--enable-source-maps` compatible — `main.ts` imports `reflect-metadata` at the top.

### Files to create / modify

- `apps/api/src/main.ts` — new file.

---

## P3-4 — `apps/api/src/app.module.ts` minimal skeleton

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S
- **Depends on:** `P3-2`

### Description

Ship the smallest possible `AppModule` that boots: imports exactly `HealthModule` and `LoggerModule` (from `nestjs-pino`).

### Acceptance Criteria

- [x] `apps/api/src/app.module.ts` exports `AppModule` decorated with `@Module({ imports: [...], controllers: [], providers: [] })`.
- [x] The `imports` array contains **only** `LoggerModule.forRoot({ ... })` and `HealthModule`.
- [x] No direct references to Prisma, Redis, Config, or `BymaxAuthModule` at this phase.
- [x] `nestjs-pino` config sets `transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' }`.
- [x] `pnpm --filter api build` succeeds.

### Files to create / modify

- `apps/api/src/app.module.ts` — new file.

---

## P3-5 — `apps/api/src/health/` module + `GET /api/health`

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S
- **Depends on:** `P3-4`

### Description

Implement the first real route: `GET /api/health` returns `{ status: 'ok', uptime, version }`.

### Acceptance Criteria

- [x] `apps/api/src/health/health.module.ts` declares `HealthController`.
- [x] `apps/api/src/health/health.controller.ts` exposes `@Controller('health')` + `@Get()` that returns `{ status: 'ok', uptime: process.uptime(), version: <pkg.version> }`.
- [x] Response shape is typed via a small interface `HealthStatus` in `health.types.ts`; no `any`.
- [x] With the Nest global prefix, the endpoint lives at `GET /api/health` — verified by curl after boot.
- [x] Returns HTTP 200, JSON content type.

### Files to create / modify

- `apps/api/src/health/health.types.ts` — new file.
- `apps/api/src/health/health.module.ts` — new file.
- `apps/api/src/health/health.controller.ts` — new file.

---

## P3-6 — Boot verification + delete Phase 2 probe file

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** XS
- **Depends on:** `P3-3`, `P3-4`, `P3-5`

### Description

Verify the end-to-end Phase 3 "definition of done": `pnpm --filter @nest-auth-example/api dev` serves `GET http://localhost:4000/api/health` with HTTP 200. Remove Phase 2 probe file.

### Acceptance Criteria

- [x] `pnpm --filter @nest-auth-example/api dev` boots cleanly on port 4000 with no runtime errors.
- [x] `curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/health` prints `200`.
- [x] Response JSON includes `status`, `uptime`, `version` keys.
- [x] `apps/api/src/auth/_probe.ts` no longer exists (was not present — Phase 2 cleanup was already done).
- [x] `pnpm --filter api typecheck` passes.

### Files to create / modify

- `apps/api/src/auth/_probe.ts` — verified absent (already cleaned up).

---

## Completion log

- P3-1 ✅ 2026-04-19 — package.json updated: scripts corrected (start/lint/test:e2e), pino-pretty added as devDep
- P3-2 ✅ 2026-04-19 — tsconfig.json (NodeNext/strict), tsconfig.build.json, nest-cli.json created
- P3-3 ✅ 2026-04-19 — main.ts: Express adapter, pino, cookie-parser, ValidationPipe, global prefix, shutdown hooks
- P3-4 ✅ 2026-04-19 — app.module.ts: LoggerModule + HealthModule only
- P3-5 ✅ 2026-04-19 — health module: GET /api/health → { status, uptime, version }, typed via HealthStatus
- P3-6 ✅ 2026-04-19 — boot verified (HTTP 200), probe file absent, typecheck passes
