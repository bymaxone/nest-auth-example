/**
 * @file prisma.service.ts
 * @description NestJS-native `PrismaService` that wraps `PrismaClient`.
 *
 * Connects to PostgreSQL on module init and disconnects on module destroy so
 * that watch-mode restarts and graceful shutdowns do not leave dangling
 * connections. Injectable by any feature module that imports `PrismaModule`.
 *
 * Prisma 7 removed datasource `url` from schema.prisma — the connection URL
 * is now provided to the runtime client via a driver adapter. `process.env` is
 * read directly in the constructor because `super()` must be called first and
 * `ConfigService` cannot be injected before the parent initialises. This is
 * the accepted exception for constructor-time env reads (same as email-provider
 * class selection in auth.module.ts).
 *
 * @layer infrastructure
 * @see prisma.module.ts
 */

import { Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Database client service extending `PrismaClient` for NestJS DI compatibility.
 *
 * Feature modules inject `PrismaService` to run queries. Repositories are the
 * only consumers; services and controllers must not import this directly.
 *
 * @public
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Stryker disable next-line ObjectLiteral,StringLiteral: this is the
    // PrismaClient bootstrap. The `super({ adapter })` call is non-optional
    // (Prisma 7 requires a driver adapter at construction time) and the
    // `'DATABASE_URL'` env key name is the single integration point with
    // the validated `env.schema.ts`. Both are unit-tested in
    // `prisma.service.spec.ts` indirectly through `onModuleInit` /
    // `onModuleDestroy`; mutating the bootstrap literal causes a runtime
    // failure on every test that mounts the service, which is not a
    // behaviour any product test should assert beyond "the service
    // instantiates".
    super({ adapter: new PrismaPg(process.env['DATABASE_URL'] ?? '') });
  }

  /**
   * Opens the database connection when the NestJS module initialises.
   *
   * Called automatically by NestJS during bootstrap. Prisma performs a lazy
   * connect by default, but calling `$connect` here surfaces connection errors
   * at startup rather than on the first query.
   */
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /**
   * Closes the database connection when the NestJS module is destroyed.
   *
   * Ensures Prisma's connection pool is drained before the process exits,
   * preventing `Connection terminated unexpectedly` errors in Postgres logs.
   */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
