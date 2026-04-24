/**
 * @file prisma.module.ts
 * @description NestJS module that registers and exports `PrismaService`.
 *
 * Import `PrismaModule` in any feature module that needs database access.
 * Only repositories and health checks should inject `PrismaService` directly;
 * services access the database via their repository abstractions.
 *
 * @layer infrastructure
 * @see prisma.service.ts
 */

import { Module } from '@nestjs/common';

import { PrismaService } from './prisma.service.js';

/**
 * Self-contained Prisma module.
 *
 * Provides and exports `PrismaService`. Not marked `@Global()` so the
 * dependency graph is explicit and cross-module imports are intentional.
 *
 * @public
 */
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
