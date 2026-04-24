# Phase 5 — Infrastructure Modules: Prisma, Redis, Health, Config — Tasks

> **Source:** [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#phase-5--infrastructure-modules-prisma-redis-health-config) §Phase 5
> **Total tasks:** 5
> **Progress:** 🟢 5 / 5 done (100%)
>
> **Status legend:** 🔴 Not Started · 🟡 In Progress · 🔵 In Review · 🟢 Done · ⚪ Blocked

## Task index

| ID   | Task                                                                      | Status | Priority | Size | Depends on     |
| ---- | ------------------------------------------------------------------------- | ------ | -------- | ---- | -------------- |
| P5-1 | `config/env.schema.ts` + `config.module.ts` (zod, global)                 | 🟢     | High     | M    | Phase 4        |
| P5-2 | `prisma/prisma.module.ts` + `prisma.service.ts`                           | 🟢     | High     | S    | `P5-1`         |
| P5-3 | `redis/redis.module.ts` + `redis.provider.ts` (`BYMAX_AUTH_REDIS_CLIENT`) | 🟢     | High     | M    | `P5-1`         |
| P5-4 | Upgrade `health.controller.ts` (PG + Redis + version + throttle demo)     | 🟢     | High     | M    | `P5-2`, `P5-3` |
| P5-5 | `logger/logger.module.ts` — nestjs-pino + `sanitizeHeaders`               | 🟢     | High     | S    | `P5-1`         |

---

## P5-1 — `config/env.schema.ts` + `config.module.ts` (zod, global)

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** M
- **Depends on:** Phase 4 (`DATABASE_URL` already declared in `.env.example`)

### Description

Introduce a typed, zod-validated config layer: a single `envSchema` that parses `process.env` at bootstrap and a global `ConfigModule` that exposes validated values via `ConfigService`. Every downstream module reads env via `ConfigService.get(...)` — nothing reads `process.env` directly. Invalid env fails fast at startup with a descriptive error.

### Acceptance Criteria

- [x] `apps/api/src/config/env.schema.ts` exports a `zod` schema covering (at minimum for this phase) `NODE_ENV`, `API_PORT`, `LOG_LEVEL`, `DATABASE_URL`, `REDIS_URL`, `REDIS_NAMESPACE`, `JWT_SECRET`, `MFA_ENCRYPTION_KEY`. Optional fields are marked optional explicitly; each has a `.describe(...)` line.
- [x] A `zodValidate(raw: Record<string, unknown>)` helper parses and throws a formatted error on failure; returns `z.infer<typeof envSchema>`.
- [x] `apps/api/src/config/config.module.ts` uses `@nestjs/config`'s `ConfigModule.forRoot({ isGlobal: true, load: [envLoader], validate: zodValidate })` where `envLoader` reads from `dotenv-safe`.
- [x] `AppModule` imports the new `ConfigModule` (replaces/extends the minimal Phase 3 skeleton).
- [x] Booting the API with a missing required var (e.g., unset `JWT_SECRET`) fails fast with a clear `zod` error — verified by a quick manual test.

### Files to create / modify

- `apps/api/src/config/env.schema.ts` — new file.
- `apps/api/src/config/config.module.ts` — new file.
- `apps/api/src/app.module.ts` — add `ConfigModule` to `imports`.
- `apps/api/package.json` — add `@nestjs/config` to deps if not already present.

### Agent Execution Prompt

> Role: Senior NestJS engineer implementing a zod-validated configuration layer.
>
> Context: The project avoids ad-hoc `process.env.FOO` reads. The env schema becomes the single source of truth for every required variable. `JWT_SECRET` and `MFA_ENCRYPTION_KEY` are required by `@bymax-one/nest-auth` downstream (Phase 6 consumes them via `ConfigService`).
>
> Objective: Create a zod schema + validator + global `ConfigModule` that fails fast on invalid env.
>
> Steps:
>
> 1. Add `@nestjs/config` to `apps/api/package.json` if missing.
> 2. Create `env.schema.ts` with `z.object({ NODE_ENV: z.enum(['development','test','production']).default('development'), API_PORT: z.coerce.number().int().positive().default(4000), LOG_LEVEL: z.enum(['debug','info','warn','error']).default('info'), DATABASE_URL: z.string().url(), REDIS_URL: z.string().url(), REDIS_NAMESPACE: z.string().default('nest-auth-example'), JWT_SECRET: z.string().min(32), MFA_ENCRYPTION_KEY: z.string().min(32) })`.
> 3. Export `zodValidate(raw)` that calls `envSchema.safeParse(raw)` and throws a single concatenated error listing every failure.
> 4. Create `envLoader()` that returns the parsed config (optionally wrapping `dotenv-safe` to fail fast on missing `.env.example` keys).
> 5. Create `config.module.ts` that exports `ConfigModule.forRoot({ isGlobal: true, load: [envLoader], validate: zodValidate })`.
> 6. Wire it into `AppModule.imports`.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (ESM, strict TS).
> - Never read `process.env.*` outside this module after this task — future phases consume `ConfigService`.
> - The schema is authoritative: if a value is not in the schema, it is not part of the contract.
>
> Verification:
>
> - `pnpm --filter api typecheck` — expected: green.
> - Unset `JWT_SECRET` and boot `pnpm --filter api dev` — expected: process exits with a `zod` validation error.
> - With valid env, `pnpm --filter api dev` — expected: server starts.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P5-1 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P5-2 — `prisma/prisma.module.ts` + `prisma.service.ts`

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S
- **Depends on:** `P5-1`

### Description

Wrap `PrismaClient` in a NestJS-native `PrismaService` that connects on `OnModuleInit` and disconnects on `OnModuleDestroy`. Export it from a `PrismaModule` so any feature module (repositories in Phase 6, Prisma-backed health checks in `P5-4`) can inject it.

### Acceptance Criteria

- [x] `apps/api/src/prisma/prisma.service.ts` declares `@Injectable() class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy { async onModuleInit() { await this.$connect(); } async onModuleDestroy() { await this.$disconnect(); } }`.
- [x] `apps/api/src/prisma/prisma.module.ts` is `@Module({ providers: [PrismaService], exports: [PrismaService] })`.
- [x] `AppModule.imports` includes `PrismaModule`.
- [x] No `any` — `PrismaService` extends the typed `PrismaClient` from `@prisma/client`.
- [x] Booting the app connects to Postgres without error.

### Files to create / modify

- `apps/api/src/prisma/prisma.service.ts` — new file.
- `apps/api/src/prisma/prisma.module.ts` — new file.
- `apps/api/src/app.module.ts` — import `PrismaModule`.

### Agent Execution Prompt

> Role: NestJS engineer wiring Prisma into the DI container.
>
> Context: Every repository / service that needs DB access will inject `PrismaService`. The lifecycle must close the client on shutdown to avoid dangling connections when NestJS restarts in watch mode.
>
> Objective: Ship a standard `PrismaService` + `PrismaModule` pair.
>
> Steps:
>
> 1. Create `apps/api/src/prisma/prisma.service.ts` with the `extends PrismaClient` pattern and the two lifecycle hooks.
> 2. Create `apps/api/src/prisma/prisma.module.ts` exporting `PrismaService`.
> 3. Import `PrismaModule` in `AppModule`.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (ESM, strict TS).
> - Do NOT pass log config to `super()` here — pino wiring is Phase 6 / Phase 7 concern.
> - Use `.js` extensions in relative imports (ESM / NodeNext).
>
> Verification:
>
> - `pnpm --filter api build` — expected: emits cleanly.
> - `pnpm --filter api dev` + hit `/api/health` (still the Phase 3 version) — expected: no connection errors logged by Prisma.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P5-2 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P5-3 — `redis/redis.module.ts` + `redis.provider.ts` (`BYMAX_AUTH_REDIS_CLIENT`)

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** M
- **Depends on:** `P5-1`

### Description

Provide a single `ioredis` client under the **exact injection token expected by the library**: `BYMAX_AUTH_REDIS_CLIENT`, re-exported from `@bymax-one/nest-auth`. This is the token `BymaxAuthModule` looks up (Phase 6/7) — a mismatch silently breaks session/brute-force/JWT-revocation features. Use `lazyConnect: true`, a capped retry strategy, and `maxRetriesPerRequest: null` (required if downstream code issues blocking commands).

### Acceptance Criteria

- [x] `apps/api/src/redis/redis.provider.ts` imports `BYMAX_AUTH_REDIS_CLIENT` from `@bymax-one/nest-auth` (or the documented server subpath). No string literal is used.
- [x] The provider factory returns a new `Redis` instance from `ioredis` configured with: `url: config.REDIS_URL`, `lazyConnect: true`, `maxRetriesPerRequest: null`, and a `retryStrategy(times) => Math.min(times * 200, 2000)`.
- [x] `apps/api/src/redis/redis.module.ts` registers the provider, marks it as a global-style export (`exports: [BYMAX_AUTH_REDIS_CLIENT]`).
- [x] `AppModule.imports` includes `RedisModule`.
- [x] On app shutdown the Redis client is quit gracefully (provider uses `onApplicationShutdown` or a `useFactory` returning an instance whose `quit()` is hooked into a Nest lifecycle).
- [x] `redis-cli -u $REDIS_URL ping` returns `PONG` — integration-level sanity check.

### Files to create / modify

- `apps/api/src/redis/redis.provider.ts` — new file.
- `apps/api/src/redis/redis.module.ts` — new file.
- `apps/api/src/app.module.ts` — import `RedisModule`.

### Agent Execution Prompt

> Role: NestJS engineer wiring ioredis with a library-mandated injection token.
>
> Context: `@bymax-one/nest-auth` resolves its Redis dependency via the exported token `BYMAX_AUTH_REDIS_CLIENT`. If the host app registers an ioredis client under any other token the library silently falls back or fails on boot. Session storage, brute-force counters, OTPs, and the JWT revocation list all depend on this client (see `docs/OVERVIEW.md` §11).
>
> Objective: Create an ioredis-backed provider registered under the exact `BYMAX_AUTH_REDIS_CLIENT` token.
>
> Steps:
>
> 1. Create `apps/api/src/redis/redis.provider.ts`:
>    - `import { BYMAX_AUTH_REDIS_CLIENT } from '@bymax-one/nest-auth'` (the server-side subpath / main entry — follow the library's exported location).
>    - Export a `redisProvider: Provider` with `provide: BYMAX_AUTH_REDIS_CLIENT`, `inject: [ConfigService]`, and `useFactory: (config) => new Redis(config.get('REDIS_URL'), { lazyConnect: true, maxRetriesPerRequest: null, retryStrategy: (times) => Math.min(times * 200, 2000) })`.
> 2. Create `apps/api/src/redis/redis.module.ts`:
>    - `@Global()` decorator (optional but recommended) + `@Module({ providers: [redisProvider], exports: [BYMAX_AUTH_REDIS_CLIENT] })`.
>    - Implement `OnApplicationShutdown` to call `quit()` on the client.
> 3. Add `RedisModule` to `AppModule.imports`.
> 4. Verify the client connects lazily on first use — log a debug line on `connect` event during boot.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (ESM, strict TS).
> - The injection token MUST come from `@bymax-one/nest-auth`'s export — no string literal, no local constant duplicate.
> - `maxRetriesPerRequest: null` is mandatory; do not lower it.
>
> Verification:
>
> - `pnpm --filter api typecheck` — expected: green, `BYMAX_AUTH_REDIS_CLIENT` resolves to a symbol exported by the library.
> - `pnpm --filter api dev` — expected: boots; debug log shows Redis `connect` event once `/api/health` is hit.
> - `redis-cli -u $REDIS_URL ping` — expected: `PONG`.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P5-3 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P5-4 — Upgrade `health.controller.ts` (PG + Redis + version + throttle demo)

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** M
- **Depends on:** `P5-2`, `P5-3`

### Description

Upgrade the Phase 3 `GET /api/health` endpoint into a real aggregate readiness probe: app uptime, Postgres `SELECT 1`, Redis `PING`, plus the installed `@bymax-one/nest-auth` version (from its `package.json`). Add a second endpoint `GET /api/health/throttle-demo` that exercises `AUTH_THROTTLE_CONFIGS` from the library (FCM row #17).

### Acceptance Criteria

- [x] `HealthController` injects `PrismaService` and the Redis client via `@Inject(BYMAX_AUTH_REDIS_CLIENT)`.
- [x] `GET /api/health` returns `{ status: 'ok' | 'degraded', uptime, version, deps: { postgres: 'ok' | 'down', redis: 'ok' | 'down', library: <version-string> } }`. Individual dep failures mark the status `degraded` but still return HTTP 200.
- [x] `SELECT 1` is issued via `prisma.$queryRaw\`SELECT 1\``; Redis check is `redis.ping()`.
- [x] The library version string is read via `createRequire`-based walk-up resolution at module load time (robust against library restructuring).
- [x] `GET /api/health/throttle-demo` is decorated with `@Throttle(AUTH_THROTTLE_CONFIGS.login)`.
- [x] `HealthModule.imports` includes `ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }])`.
- [x] Hitting `/api/health/throttle-demo` in a tight loop eventually returns HTTP 429.

### Files to create / modify

- `apps/api/src/health/health.controller.ts` — upgrade existing file.
- `apps/api/src/health/health.module.ts` — import `PrismaModule`, `RedisModule`, `ThrottlerModule`.

### Agent Execution Prompt

> Role: NestJS engineer building an aggregate readiness probe and wiring `@nestjs/throttler` via the library's shared config.
>
> Context: Phase 5 ends with a health endpoint that genuinely reflects backing-service status. The `throttle-demo` endpoint is the hook used by FCM row #17's frontend demo in later phases.
>
> Objective: Rewrite `HealthController` to aggregate Postgres + Redis + library version, and add a throttled demo endpoint.
>
> Steps:
>
> 1. Update `HealthController` constructor to inject `PrismaService` and `@Inject(BYMAX_AUTH_REDIS_CLIENT) redis: Redis`.
> 2. Implement an `async check()` method that runs `SELECT 1` (wrapped in try/catch) and `redis.ping()` (ditto), returning the aggregate shape above.
> 3. Import `@bymax-one/nest-auth/package.json` (JSON module) to read `version`; expose it under `deps.library`.
> 4. Add a second controller method `throttleDemo()` decorated with `@Throttle(AUTH_THROTTLE_CONFIGS.<pickedTier>)` returning `{ ok: true, at: new Date().toISOString() }`.
> 5. Update `HealthModule` to import `PrismaModule`, `RedisModule`, and register `ThrottlerModule.forRoot(AUTH_THROTTLE_CONFIGS)` — the library exports the shape expected by `@nestjs/throttler`.
> 6. Ensure `AppModule` still imports `HealthModule` (unchanged from Phase 3).
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (ESM, strict TS).
> - Health endpoint MUST NOT return HTTP 5xx on Redis/Postgres failure — return 200 with `status: 'degraded'`. That is what most orchestrators expect for readiness while we still have a controllable body.
> - Use `AUTH_THROTTLE_CONFIGS` as imported from `@bymax-one/nest-auth` — do NOT copy the values locally.
>
> Verification:
>
> - `curl -s http://localhost:4000/api/health | jq .deps` — expected: `postgres === 'ok'`, `redis === 'ok'`, `library` matches the installed `@bymax-one/nest-auth` version.
> - `for i in $(seq 1 50); do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/api/health/throttle-demo; done | sort -u` — expected: includes at least one `429`.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P5-4 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## P5-5 — `logger/logger.module.ts` — nestjs-pino + `sanitizeHeaders`

- **Status:** 🟢 Done
- **Priority:** High
- **Size:** S
- **Depends on:** `P5-1`

### Description

Promote the inline `LoggerModule.forRoot(...)` from Phase 3's `AppModule` into a dedicated `LoggerModule` that wires `nestjs-pino` with the library's `sanitizeHeaders` helper, redacting sensitive headers (Authorization, Cookie, Set-Cookie, X-\*) from request/response logs.

### Acceptance Criteria

- [x] `apps/api/src/logger/logger.module.ts` wraps `LoggerModule.forRootAsync({ inject: [ConfigService], useFactory: (config) => ({ pinoHttp: { level, transport, redact, serializers: { req: (req) => ({ ...req, headers: sanitizeHeaders(req.headers) }) } } }) })`.
- [x] `sanitizeHeaders` is imported from `@bymax-one/nest-auth` — no local reimplementation.
- [x] `AppModule` imports the new `LoggerModule` (removes the inline `LoggerModule.forRoot(...)` call).
- [x] `pino-pretty` transport is only applied when `NODE_ENV !== 'production'`.
- [x] Hitting `/api/health` with `Authorization: Bearer secret` logs a request line whose `headers.authorization` appears as `[REDACTED]` (or whatever `sanitizeHeaders` returns).
- [x] `LOG_LEVEL` from the env schema drives the pino level.

### Files to create / modify

- `apps/api/src/logger/logger.module.ts` — new file.
- `apps/api/src/app.module.ts` — replace the inline logger registration with `LoggerModule`.

### Agent Execution Prompt

> Role: NestJS engineer hardening request logging with library-provided header sanitization.
>
> Context: The library exports `sanitizeHeaders` precisely so consumer apps do not re-derive the redaction list. Per FCM rows and `docs/DEVELOPMENT_PLAN.md` §Phase 5, this is the canonical wiring.
>
> Objective: Extract logger setup into its own module and plug in `sanitizeHeaders` as the pino request serializer.
>
> Steps:
>
> 1. Create `apps/api/src/logger/logger.module.ts` exporting a `LoggerModule` that re-exports `nestjs-pino`'s `LoggerModule.forRootAsync(...)` with `inject: [ConfigService]`.
> 2. Inside the factory, build `pinoHttp`:
>    - `level: config.get('LOG_LEVEL')`.
>    - `transport: config.get('NODE_ENV') === 'production' ? undefined : { target: 'pino-pretty' }`.
>    - `serializers: { req: (req) => ({ id: req.id, method: req.method, url: req.url, headers: sanitizeHeaders(req.headers as Record<string, unknown>) }) }`.
> 3. Import `sanitizeHeaders` from `@bymax-one/nest-auth` (server export).
> 4. Replace the inline `LoggerModule.forRoot(...)` in `AppModule` with `LoggerModule` from this new file.
> 5. Manually test by `curl -H 'Authorization: Bearer secret-token' http://localhost:4000/api/health` and verify the logged request line redacts the header.
>
> Constraints:
>
> - Follow `docs/DEVELOPMENT_PLAN.md` §2 (ESM, strict TS).
> - Never log `Set-Cookie`, `Cookie`, or `Authorization` in cleartext — defer entirely to `sanitizeHeaders`.
> - Do NOT duplicate `sanitizeHeaders` logic in this repo.
>
> Verification:
>
> - `pnpm --filter api typecheck` — expected: green.
> - `curl -H 'Authorization: Bearer test' http://localhost:4000/api/health` then inspect server logs — expected: `authorization` header not visible in cleartext.

### Completion Protocol

1. ✅ Status → `🟢 Done`.
2. ✅ Tick Acceptance Criteria.
3. ✅ Update Task index row.
4. ✅ Bump **Progress** counter.
5. ✅ Update [`../DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md#progress-summary) row + overall progress (/126).
6. ✅ Append `- P5-5 ✅ YYYY-MM-DD — <one-line>` to **Completion log**.

⚠️ Never mark done with failing verification.

---

## Completion log

- P5-1 ✅ 2026-04-24 — Zod env schema with superRefine cross-field constraints + global `AppConfigModule` wired into `AppModule`
- P5-2 ✅ 2026-04-24 — `PrismaService extends PrismaClient` with `OnModuleInit`/`OnModuleDestroy` lifecycle hooks; `PrismaModule` exports it
- P5-3 ✅ 2026-04-24 — `ioredis` provider under `BYMAX_AUTH_REDIS_CLIENT` token with `lazyConnect`, retry strategy, and graceful `quit()` on shutdown
- P5-4 ✅ 2026-04-24 — Aggregate readiness probe (`SELECT 1` + `PING` + library version walk-up) and `@Throttle(AUTH_THROTTLE_CONFIGS.login)` demo endpoint
- P5-5 ✅ 2026-04-24 — `AppLoggerModule` with `sanitizeHeaders` from library, conditional `pino-pretty`, full redact list, `customProps` for requestId/tenantId
