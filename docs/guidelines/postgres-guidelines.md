# PostgreSQL Guidelines

Primary datastore. Schemas are owned by Prisma; this document covers the choices that live below the ORM.

- **Version**: PostgreSQL **18** (Alpine image in dev)
- **Dev port**: `5432` (`127.0.0.1` bind only)
- **Init script**: `docker/postgres/init.sql`
- **Official docs**: https://www.postgresql.org/docs/18/

---

## When to read this

Before adding an index or constraint, writing raw SQL (`$queryRaw`), changing the connection string shape, modifying the init script, or profiling a slow query.

---

## Connection

Every runtime uses the `DATABASE_URL` env var. Examples:

```
# Dev (docker-compose)
postgres://postgres:postgres@localhost:5432/example_app

# Tests (docker-compose.test.yml)
postgres://postgres:postgres@localhost:55432/example_app_test

# Prod
postgresql://user:pass@db.internal:5432/example_app?sslmode=require&connection_limit=20&pool_timeout=10
```

- Always `sslmode=require` (or `verify-full`) outside local dev.
- Set `connection_limit` to match app instance count × pod count — default 10 per client is fine for dev but blows up on autoscaling.
- Use PgBouncer (transaction mode) for serverless or high-concurrency prod; document it in `docs/DEPLOYMENT.md`.

---

## Schema conventions

Owned by Prisma. Rules that Prisma does not enforce:

- **Lowercase snake_case** for table and column names (`audit_logs`, `tenant_id`). Prisma maps PascalCase model names to snake_case via `@@map` / `@map` when the surrounding codebase expects it — we keep model names PascalCase and column/table names as Prisma's defaults.
- **Plural tables** (`users`, `projects`, `audit_logs`). Prisma model names are singular (`User`, `Project`, `AuditLog`).
- **IDs**: `text` with a CUID2 generated in application code via Prisma's `cuid()`. Avoid integer `serial` for any entity that appears in a URL — it leaks cardinality.
- **Timestamps**: `timestamptz`, always. Never `timestamp` (no time zone). Prisma's `DateTime` maps to `timestamptz` with PostgreSQL.
- **Enums as `text` + check constraint**, not SQL `enum`. Adding a value to a SQL enum requires a migration that can't run inside a transaction in some configurations; text + check is boring and safe.

---

## Indexes

Every foreign-key column gets an index — Postgres does not create one automatically. Prisma generates them when you write `@@index`.

```prisma
model Project {
  id        String   @id @default(cuid())
  tenantId  String
  ownerId   String
  // ...
  @@index([tenantId])
  @@index([ownerId])
  @@index([tenantId, updatedAt(sort: Desc)])
}
```

- Multi-column indexes for the exact filter + sort your dashboards use — the last index above serves `WHERE tenantId = ? ORDER BY updatedAt DESC`.
- Partial indexes for soft-delete tables: `@@index([tenantId], where: { archivedAt: null })` — Prisma 7 supports them via raw `@@index` args.
- Never add an index "just in case"; each one costs write amplification and disk.

### Unique constraints

- `@@unique([tenantId, email])` on `users` enforces tenant-scoped uniqueness.
- `@unique` on a single column without a tenant scope is almost always wrong in a multi-tenant app — review before merging.

---

## Locking & concurrency

Default isolation is `READ COMMITTED`. Use `SERIALIZABLE` via `prisma.$transaction(fn, { isolationLevel: 'Serializable' })` only when you genuinely need it — the library's session eviction, for example, relies on atomicity but uses Redis, not Postgres.

- **Row-level locks**: Prisma does not expose `SELECT ... FOR UPDATE` directly. When needed, use `$queryRaw` inside the transaction closure. Document why in a comment.
- **Long-running transactions**: < 200 ms target. Anything longer blocks `vacuum` and other writers.
- **Background jobs** that touch auth data must use the library's services, not raw SQL — otherwise audit and cache invalidation silently skip.

---

## Migrations in production

Rules that apply on top of Prisma migrations:

1. **Additive first**: add a nullable column, backfill, flip to `NOT NULL`. One migration per step on large tables.
2. **Never drop a column in the same release that stops writing to it**. Ship the code change, confirm in prod, then drop in the next release.
3. **Renames are two migrations** — add the new column, dual-write, cutover reads, drop the old column.
4. **`CREATE INDEX CONCURRENTLY`** for production on tables > 1M rows. Prisma generates `CREATE INDEX` by default; edit the generated SQL and add `CONCURRENTLY`, and drop the migration's implicit transaction by adding `-- prisma-migrate-no-transaction` at the top of the file.

---

## Raw SQL

Avoid unless Prisma genuinely cannot express it. If you must:

- **`$queryRaw` with tagged templates**. Never string concatenation.
  ```ts
  const rows = await prisma.$queryRaw<RowShape[]>`SELECT ... WHERE tenant_id = ${tenantId}`;
  ```
- Parameters are always bound. **Never** interpolate user input into the template literal.
- Every raw query has a typed return type — no `unknown[]` results leaking upwards.

---

## Healthchecks & observability

- `healthcheck` in `docker-compose.yml` uses `pg_isready`; our app's `/health` endpoint independently runs `SELECT 1` via Prisma to cover connection pool exhaustion.
- Structured `pg_stat_statements` extension is **enabled in prod**, not in dev. Document with your deploy platform.
- Log slow queries at the Prisma level (`log: ['query', { level: 'warn', emit: 'event' }]`) and ship the warnings, not the raw queries — they may contain tenant data.

---

## Backup & restore

Out of scope for this example; cover in `docs/DEPLOYMENT.md`. Summary of the policy we recommend:

- Daily logical `pg_dump --format=custom` to object storage, retention ≥ 30 days.
- PITR via WAL archiving if your platform supports it.
- Document the restore test cadence. A backup you never restored is a rumor.

---

## Common pitfalls

1. **`timestamp` without time zone** — every downstream library mis-interprets the tz; `timestamptz` fixes it.
2. **Case-sensitive collation** (`LC_COLLATE 'C'`) combined with email comparison — our init script uses `'C'` for deterministic ordering, but application code compares email via `lower(email)` in raw SQL. Prisma handles this via the library's `findByEmail`.
3. **Missing `ON DELETE` on FKs** — orphan rows accumulate. Prisma defaults to `SetNull` or `Restrict`; pick intentionally per relation.
4. **Seq scans on a `tenantId` filter** — add the index. Run `EXPLAIN ANALYZE` to confirm.
5. **Using `pg_dump` on a schema with extensions without `--no-owner --no-privileges`** — restores fail on the target. Include in the runbook.
6. **`vacuum full` in prod** — acquires an access-exclusive lock. Use `vacuum` or autovacuum tuning.

---

## References

- PostgreSQL 18 docs: https://www.postgresql.org/docs/18/
- Prisma + Postgres: https://www.prisma.io/docs/orm/overview/databases/postgresql
- Index cookbook: https://use-the-index-luke.com/
