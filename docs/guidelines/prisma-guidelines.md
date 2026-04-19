# Prisma ORM Guidelines

Type-safe database access for `apps/api`.

- **Package**: `@prisma/client`, `prisma` (dev)
- **Version**: `^7.7.x`
- **Database**: PostgreSQL 18 (see [postgres-guidelines.md](postgres-guidelines.md))
- **Schema location**: `apps/api/prisma/schema.prisma`
- **Official docs**: https://www.prisma.io/docs

---

## When to read this

Before touching `apps/api/prisma/schema.prisma`, writing a query, adding a migration, or implementing an `IUserRepository` / `IPlatformUserRepository` for `@bymax-one/nest-auth`.

---

## Schema organization

One `schema.prisma` file. Split into logical sections with comment headers. Prisma 7 supports multi-file schemas via `prismaSchemaFolder`; we keep it single-file for now — switch only if the schema exceeds ~500 lines.

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = []
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ---------- Auth (mirrors @bymax-one/nest-auth contract) ----------
model User { ... }
model PlatformUser { ... }
model Invitation { ... }

// ---------- Audit ----------
model AuditLog { ... }

// ---------- Example domain ----------
model Tenant { ... }
model Project { ... }
```

### Non-negotiables

1. **`passwordHash`, `mfaSecret`, `mfaRecoveryCodes` are stored verbatim** as the library returns them. Never re-hash, never transform, never `String(...)` them.
2. Every table has `createdAt @default(now())` and `updatedAt @updatedAt`.
3. Every user-facing table with a tenant scope has `tenantId String` + `@@index([tenantId])`.
4. IDs are `String @id @default(cuid())` unless the library contract says otherwise.
5. Nullable columns have an explicit `?`; `String` defaults to `NOT NULL`.
6. Every `@relation` gets an explicit `name: "..."` when the model has more than one relation to the same other model.

---

## User model (library contract)

The `User` fields map 1:1 with `IUserRepository`. Do not add required fields — they break library-issued inserts.

```prisma
model User {
  id                String   @id @default(cuid())
  tenantId          String
  email             String
  name              String?
  passwordHash      String?  // null for OAuth-only accounts
  role              String   @default("member")
  status            String   @default("active") // active | pending | suspended | locked
  emailVerified     Boolean  @default(false)
  mfaEnabled        Boolean  @default(false)
  mfaSecret         String?  // encrypted at rest by the library
  mfaRecoveryCodes  String[] // hashed by the library
  oauthProvider     String?
  oauthProviderId   String?
  lastLoginAt       DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([tenantId, email])
  @@unique([oauthProvider, oauthProviderId])
  @@index([tenantId])
  @@index([status])
}
```

`[tenantId, email]` is the natural uniqueness — two tenants can legitimately own the same email.

---

## Migrations

Use `prisma migrate dev` locally. Production uses `prisma migrate deploy` only.

```bash
# Locally after a schema change
pnpm --filter @nest-auth-example/api prisma:migrate -- --name <descriptive_snake_case>

# Generate client without migrating
pnpm --filter @nest-auth-example/api prisma:generate

# Production deploy (CI / release pipeline)
pnpm --filter @nest-auth-example/api prisma:migrate:deploy
```

**Rules**:

- One migration = one schema change with a clear purpose. Name it like a conventional commit scope: `add_audit_log`, `add_project_tenant_fk`, `soften_user_name_nullability`.
- Never hand-edit a migration SQL file after it has been applied outside your local box. Create a follow-up migration instead.
- Destructive migrations (dropping columns, renaming) — review the generated SQL, then add a comment at the top explaining why.
- Never commit a migration without running it locally end-to-end at least once.

---

## Prisma client

One `PrismaService` per app. Extend `PrismaClient`; implement `OnModuleInit` / `OnModuleDestroy`.

```ts
// apps/api/src/prisma/prisma.service.ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: [
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
      ],
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

- **Single instance**. Never `new PrismaClient()` outside `PrismaService`.
- **Log events, not stdout strings** — forward to `nestjs-pino` (see [logging-guidelines.md](logging-guidelines.md)).
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

## Query patterns

### Prefer narrow `select` over `include`

```ts
this.prisma.project.findMany({
  where: { tenantId },
  select: { id: true, name: true, updatedAt: true },
  orderBy: { updatedAt: 'desc' },
});
```

- Keep payloads minimal — never fetch `passwordHash` unless the library asks for it.
- `include` only when the caller genuinely needs the whole relation shape.

### Transactions

```ts
await this.prisma.$transaction(async (tx) => {
  const project = await tx.project.create({ data: { tenantId, name } });
  await tx.auditLog.create({
    data: { type: 'PROJECT_CREATED', actorId: userId, refId: project.id },
  });
  return project;
});
```

- Use interactive transactions for anything multi-step that must be atomic.
- Keep the closure short — long transactions hold row locks. Anything > 200 ms is suspicious.

### Pagination

Cursor-based, never `skip` on large tables. `skip` scans the offset:

```ts
this.prisma.auditLog.findMany({
  where: { tenantId },
  orderBy: { createdAt: 'desc' },
  take: 50,
  ...(cursor && { cursor: { id: cursor }, skip: 1 }),
});
```

---

## Seeding

`apps/api/prisma/seed.ts`. Pure TS, no runtime framework. Fills a repeatable demo state — tenants, admin user, member user, sample project.

```bash
pnpm --filter @nest-auth-example/api prisma:seed
```

- Idempotent: `upsert` by unique key. Running `prisma:seed` twice must not duplicate rows.
- Uses `@bymax-one/nest-auth` password hasher for the demo password — never `bcrypt.hash()` directly.
- Passwords in seed files are documented in README (`demo/demo1234!`) and rotated whenever a snapshot is published.

---

## Testing

- **Unit tests** mock `PrismaService` via `@nestjs/testing` `useValue(prismaStub)`.
- **Integration / e2e** run against a real Postgres started by `docker-compose.test.yml`. Reset with `prisma migrate reset --force --skip-seed` between suites.
- Never run tests against the dev database — configure `DATABASE_URL_TEST` and assert it differs from `DATABASE_URL` in the test bootstrap.

See [testing-guidelines.md](testing-guidelines.md) for the full pattern.

---

## Common pitfalls

1. **Re-hashing `passwordHash`** — library signs tokens against the stored hash. Any mutation locks every user out.
2. **`update` where you meant `upsert`** on seed scripts — non-idempotent seeds break `pnpm infra:up && pnpm seed` cycles.
3. **Missing `@@unique([tenantId, email])`** — multi-tenant isolation leaks; two tenants can claim the same email with race conditions.
4. **Forgetting `@@index([tenantId])`** — every dashboard query becomes a seq scan as the table grows.
5. **`$transaction([q1, q2])` batch form** for operations that depend on previous results — use the async closure form.
6. **`select: { passwordHash: true }` in a general repository read** — leaks hash to logs, audit trails, serializers.
7. **`prisma db push` on main branches** — always go through a migration. `db push` is only for throwaway prototypes.
8. **Running migrations in tests with data in them** — tests use `migrate reset` before each suite; never migrate forward against dev data.

---

## References

- Prisma docs: https://www.prisma.io/docs
- Schema reference: https://www.prisma.io/docs/orm/reference/prisma-schema-reference
- `@bymax-one/nest-auth` repository contracts: [nest-auth-guidelines.md](nest-auth-guidelines.md)
- PostgreSQL specifics: [postgres-guidelines.md](postgres-guidelines.md)
