/**
 * @file prisma.service.ts
 * @description NestJS-native `PrismaService` that wraps `PrismaClient`.
 *
 * Connects to PostgreSQL on module init and disconnects on module destroy so
 * that watch-mode restarts and graceful shutdowns do not leave dangling
 * connections. Injectable by any feature module that imports `PrismaModule`.
 *
 * @layer infrastructure
 * @see prisma.module.ts
 */

import { Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
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
