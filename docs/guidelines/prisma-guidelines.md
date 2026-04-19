# Prisma ORM Guidelines

Type-safe database access for `apps/api`.

- **Packages**: `@prisma/client`, `@prisma/adapter-pg`, `prisma` (dev)
- **Version**: `^7.7.x`
- **Database**: PostgreSQL 18 (see [postgres-guidelines.md](postgres-guidelines.md))
- **Schema location**: `apps/api/prisma/schema.prisma`
- **CLI config**: `apps/api/prisma.config.ts`
- **Official docs**: https://www.prisma.io/docs

---

## When to read this

Before touching `apps/api/prisma/schema.prisma`, writing a query, adding a migration, working with `prisma.config.ts`, or implementing an `IUserRepository` / `IPlatformUserRepository` for `@bymax-one/nest-auth`.

---

## Prisma 7 architecture

Prisma 7 introduced a driver-adapter model that replaces the built-in Rust query engine. The `DATABASE_URL` no longer lives in `schema.prisma`; it moves to the CLI config file. The runtime client requires an explicit driver adapter.

### What changed from Prisma 6

| Concern        | Prisma 6                                        | Prisma 7                                       |
| -------------- | ----------------------------------------------- | ---------------------------------------------- |
| Connection URL | `url = env("DATABASE_URL")` in `schema.prisma`  | `datasource.url` in `prisma.config.ts`         |
| CLI config     | `package.json` `"prisma"` key                   | `prisma.config.ts` (`defineConfig`)            |
| Runtime driver | Built-in Rust engine                            | Explicit driver adapter (`@prisma/adapter-pg`) |
| `PrismaClient` | `new PrismaClient()`                            | `new PrismaClient({ adapter })`                |
| Seed command   | `"prisma": { "seed": "..." }` in `package.json` | `migrations.seed` in `prisma.config.ts`        |

---

## `prisma.config.ts`

The CLI configuration file. It lives at `apps/api/prisma.config.ts` and is the single source of truth for CLI operations: schema path, datasource URL, and seed command. The `dotenv/config` import must come first so `env()` can read `.env`.

```ts
// apps/api/prisma.config.ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
```

**Rules**:

- `import 'dotenv/config'` must be the first line — `env()` reads from `process.env`, which must be populated before `defineConfig` runs.
- `env('DATABASE_URL')` throws at CLI startup if the variable is missing — fast failure, no silent `undefined`.
- Do not duplicate the datasource URL in `schema.prisma`; the `datasource db` block contains only `provider`.

---

## Schema organization

One `schema.prisma` file. Split into logical sections with comment headers. Prisma 7 supports multi-file schemas via `prismaSchemaFolder`; keep it single-file until the schema exceeds ~500 lines.

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = []
}

// No `url` field here — connection URL lives in prisma.config.ts (Prisma 7)
datasource db {
  provider = "postgresql"
}

// ---------- Auth (mirrors @bymax-one/nest-auth contract) ----------
model User        { ... }
model PlatformUser { ... }
model Invitation  { ... }

// ---------- Audit ----------
model AuditLog { ... }

// ---------- Example domain ----------
model Tenant  { ... }
model Project { ... }
```

### Non-negotiables

1. **`passwordHash`, `mfaSecret`, `mfaRecoveryCodes` are stored verbatim** as the library returns them. Never re-hash, never transform.
2. Every mutable table has `createdAt @default(now())` and `updatedAt @updatedAt`. Append-only tables (e.g., `AuditLog`) intentionally omit `updatedAt` — add a comment explaining why.
3. Every user-facing table with a tenant scope has `tenantId String` + `@@index([tenantId])`.
4. IDs are `String @id @default(cuid())` unless the library contract says otherwise.
5. Nullable columns have an explicit `?`; `String` defaults to `NOT NULL`.
6. Use Prisma enums (`enum Role { OWNER ADMIN MEMBER VIEWER }`) for column types that have a bounded domain; do not use raw `String` for enum-like values.

---

## Enums

Define enums at the top of the schema, before the models that reference them.

```prisma
enum Role {
  OWNER
  ADMIN
  MEMBER
  VIEWER
}

enum UserStatus {
  ACTIVE
  PENDING
  SUSPENDED
  BANNED
  INACTIVE
}

enum PlatformRole {
  SUPER_ADMIN
  SUPPORT
}
```

Enum values are uppercase in Prisma and stored as uppercase strings in PostgreSQL. The `@bymax-one/nest-auth` library expects uppercase string values matching these names — do not rename them.

---

## User model (library contract)

The `User` fields map 1:1 with `IUserRepository`. Do not add required fields without nullable defaults — they break library-issued inserts.

```prisma
model User {
  id               String     @id @default(cuid())
  tenantId         String
  email            String
  name             String
  passwordHash     String?                        // null for OAuth-only accounts
  role             Role       @default(MEMBER)
  status           UserStatus @default(ACTIVE)
  emailVerified    Boolean    @default(false)
  mfaEnabled       Boolean    @default(false)
  mfaSecret        String?                        // encrypted at rest by the library
  mfaRecoveryCodes String[]                       // hashed by the library
  oauthProvider    String?
  oauthProviderId  String?
  lastLoginAt      DateTime?
  createdAt        DateTime   @default(now())
  updatedAt        DateTime   @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, email])
  @@unique([oauthProvider, oauthProviderId])
  @@index([tenantId])
}
```

`[tenantId, email]` is the natural uniqueness constraint — two tenants can legitimately own the same email address.

---

## Driver adapter (`@prisma/adapter-pg`)

Prisma 7 requires an explicit driver adapter at runtime. `@prisma/adapter-pg` wraps the `pg` client.

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter });
```

- `connectionString` is a PostgreSQL connection string: `postgresql://user:pass@host:port/db`.
- The adapter is created once and passed to `PrismaClient` at construction time.
- In `PrismaService` (NestJS), inject the connection string from `ConfigService` — never `process.env` directly.

---

## Prisma client (NestJS)

One `PrismaService` per app. It creates the adapter from config and passes it to `PrismaClient`. Extend `PrismaClient`; implement `OnModuleInit` / `OnModuleDestroy`.

```ts
// apps/api/src/prisma/prisma.service.ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    const adapter = new PrismaPg({
      connectionString: config.get('DATABASE_URL', { infer: true }),
    });
    super({
      adapter,
      log: [
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

**Rules**:

- **Single instance**. Never `new PrismaClient()` outside `PrismaService`.
- **Adapter required** — omitting it causes a Prisma 7 runtime error.
- **Config via `ConfigService`** — never `process.env.DATABASE_URL` inside NestJS modules.
- **Log events, not stdout strings** — forward `warn`/`error` events to `nestjs-pino` (see [logging-guidelines.md](logging-guidelines.md)).
- **Graceful shutdown**: `enableShutdownHooks` on the Nest app fires `onModuleDestroy` → `$disconnect`. Absence of this causes open connections after container SIGTERM.

---

## Repositories (library contract)

`PrismaUserRepository` implements `IUserRepository`. Other domain modules implement their own repository or use `PrismaService` directly — pick one per module and stay consistent.

```ts
// apps/api/src/auth/prisma-user.repository.ts
@Injectable()
export class PrismaUserRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(tenantId: string, email: string) {
    return this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
    });
  }

  // ... every other method on IUserRepository
}
```

**Repository rules**:

- Only selects/updates raw columns. Never composes business logic.
- Never calls another service. Never reads Redis. Never does HTTP.
- Returns exactly what the interface declares — no "helpful" joins, no decorated results.

---

## Migrations

Use `prisma migrate dev` locally via the pnpm script or `npx`/direct invocation. Production uses `prisma migrate deploy` only.

```bash
# Locally after a schema change — run from apps/api/
npx prisma migrate dev --name <descriptive_snake_case>

# Or via pnpm script (no --name passthrough due to pnpm arg bug — omit to get interactive prompt)
pnpm --filter @nest-auth-example/api prisma:migrate

# Generate client without migrating
pnpm --filter @nest-auth-example/api prisma:generate

# Production deploy (CI / release pipeline)
pnpm --filter @nest-auth-example/api prisma:migrate:deploy
```

> **Note on `--name` with pnpm**: `pnpm --filter ... prisma:migrate -- --name foo` passes a literal `--` to the Prisma CLI, causing it to ignore `--name`. Run migrations requiring a specific name directly with `npx prisma migrate dev --name foo` from `apps/api/`.

**Rules**:

- One migration = one schema change with a clear purpose. Name it like a conventional commit scope: `add_audit_log`, `add_project_tenant_fk`, `soften_user_name_nullability`.
- Never hand-edit a migration SQL file after it has been applied outside your local box. Create a follow-up migration instead.
- Destructive migrations (dropping columns, renaming) — review the generated SQL and add a comment at the top explaining why.
- Never commit a migration without running it locally end-to-end at least once.

---

## Seeding

`apps/api/prisma/seed.ts`. Pure TS, no runtime framework. Fills a reproducible demo state — tenants, users per role, platform admin.

The seed command is configured in `prisma.config.ts` under `migrations.seed`, not in `package.json`.

```bash
pnpm --filter @nest-auth-example/api prisma:seed
```

**Seed rules**:

- **Idempotent**: every write uses `upsert` keyed on the natural unique constraint. Running the seed twice must produce identical state.
- **Use `bcryptjs`** for password hashing — pure-JS bcrypt, no native addon, identical `$2b$` hash format. Import as `import bcryptjs from 'bcryptjs'`. Never use `bcrypt` (requires native build scripts blocked by pnpm 10 by default).
- **Import `dotenv/config`** at the top of `seed.ts` — the seed script runs outside NestJS, so env vars must be loaded explicitly.
- **Use the `PrismaPg` adapter** in seed scripts — same as production, so connection behavior is identical.
- **Error logging**: catch errors and log only `err.message`, never the full error object — Prisma/pg errors may embed `DATABASE_URL` in the stack.
- **Known passwords**: document the seed password in `GETTING_STARTED.md` and mark it clearly as dev-only. Never reuse a seed password in production.

```ts
// apps/api/prisma/seed.ts — minimal skeleton
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcryptjs from 'bcryptjs';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('[seed] DATABASE_URL is not set.');

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const passwordHash = await bcryptjs.hash('Passw0rd!Passw0rd', 12);
  await prisma.tenant.upsert({
    where: { slug: 'acme' },
    update: {},
    create: { name: 'Acme Corp', slug: 'acme' },
  });
  // ... more upserts
}

main()
  .catch((err: unknown) => {
    console.error('[seed] Fatal error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
```

---

## Query patterns

### Prefer narrow `select` over `include`

```ts
this.prisma.project.findMany({
  where: { tenantId },
  select: { id: true, name: true, updatedAt: true },
  orderBy: { updatedAt: 'desc' },
});
```

- Keep payloads minimal — never fetch `passwordHash` unless the library explicitly asks for it.
- `include` only when the caller genuinely needs the whole relation shape.

### Transactions

```ts
await this.prisma.$transaction(async (tx) => {
  const project = await tx.project.create({ data: { tenantId, name } });
  await tx.auditLog.create({
    data: {
      event: 'PROJECT_CREATED',
      actorUserId: userId,
      tenantId,
      payload: { projectId: project.id },
    },
  });
  return project;
});
```

- Use interactive transactions (async closure form) for anything multi-step that must be atomic.
- Avoid the batch form (`$transaction([q1, q2])`) when operations depend on each other's results.
- Keep the closure short — long transactions hold row locks. Anything > 200 ms is suspicious.

### Pagination

Cursor-based, never `skip` on large tables. `skip` scans the full offset:

```ts
this.prisma.auditLog.findMany({
  where: { tenantId },
  orderBy: { createdAt: 'desc' },
  take: 50,
  ...(cursor && { cursor: { id: cursor }, skip: 1 }),
});
```

---

## Testing

- **Unit tests** mock `PrismaService` via `@nestjs/testing` `useValue(prismaStub)`.
- **Integration / e2e** run against a real Postgres started by `docker-compose.test.yml`. Reset with `prisma migrate reset --force --skip-seed` between suites.
- Never run tests against the dev database — configure `DATABASE_URL_TEST` and assert it differs from `DATABASE_URL` in the test bootstrap.

See [testing-guidelines.md](testing-guidelines.md) for the full pattern.

---

## Common pitfalls

1. **Omitting the driver adapter** — `new PrismaClient()` without `{ adapter }` throws in Prisma 7. Every instantiation (service, seed, tests) needs `PrismaPg`.
2. **`url` in `schema.prisma` datasource block** — Prisma 7 removed support for `url` in the schema file. Remove it; the URL lives in `prisma.config.ts` only.
3. **Missing `import 'dotenv/config'` in `prisma.config.ts` or `seed.ts`** — these scripts run outside NestJS; env vars are not loaded automatically. The import must be first.
4. **Using `bcrypt` instead of `bcryptjs`** — `bcrypt` requires a native build script that pnpm 10 blocks by default. Use `bcryptjs`; it produces identical `$2b$` hashes with no native addon.
5. **`pnpm --filter ... -- --name foo` passthrough bug** — the literal `--` is passed to Prisma, which ignores `--name`. Run migrations from `apps/api/` with `npx prisma migrate dev --name foo`.
6. **Re-hashing `passwordHash`** — the library signs tokens against the stored hash. Any mutation invalidates all sessions for that user.
7. **`update` where you meant `upsert` in seed scripts** — non-idempotent seeds break `pnpm infra:up && prisma:seed` cycles.
8. **Missing `@@unique([tenantId, email])`** — multi-tenant isolation leaks; two users in different tenants can collide in race conditions without this constraint.
9. **Forgetting `@@index([tenantId])`** — every per-tenant dashboard query becomes a sequential scan as the table grows.
10. **`$transaction([q1, q2])` batch form for dependent operations** — use the async closure form when `q2` depends on `q1`'s result.
11. **`select: { passwordHash: true }` in a general repository read** — leaks the hash to logs, audit trails, and serializers.
12. **`prisma db push` on main branches** — always go through a migration. `db push` is only for throwaway prototypes.
13. **Logging the full Prisma error object** — errors may embed `DATABASE_URL` in their stack. Log only `err.message`.

---

## References

- Prisma 7 docs: https://www.prisma.io/docs
- Schema reference: https://www.prisma.io/docs/orm/reference/prisma-schema-reference
- Prisma config reference: https://www.prisma.io/docs/orm/reference/prisma-config-reference
- Driver adapters: https://www.prisma.io/docs/orm/overview/databases/database-drivers
- `@bymax-one/nest-auth` repository contracts: [nest-auth-guidelines.md](nest-auth-guidelines.md)
- PostgreSQL specifics: [postgres-guidelines.md](postgres-guidelines.md)
