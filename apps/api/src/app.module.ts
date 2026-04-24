/**
 * @file app.module.ts
 * @description Root NestJS module for `@nest-auth-example/api`.
 *
 * Phase 5: Registers all infrastructure modules (Config, Logger, Prisma, Redis)
 * and the health-check module. Later phases layer in `BymaxAuthModule` (Phase 7),
 * `ThrottlerModule` globally (Phase 7), and domain modules (Tenants, Projects).
 *
 * Import order is intentional:
 * 1. `AppConfigModule` must be first — it registers `ConfigService` globally so
 *    every subsequent module's async factories can inject it.
 * 2. `AppLoggerModule` comes next to capture all subsequent bootstrap logs.
 * 3. `PrismaModule` and `RedisModule` are infrastructure with no ordering constraint
 *    relative to each other.
 *
 * @layer root
 */

import { Module } from '@nestjs/common';

import { AppConfigModule } from './config/config.module.js';
import { AppLoggerModule } from './logger/logger.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { HealthModule } from './health/health.module.js';

/**
 * Application root module.
 *
 * Contains no business logic — only wires infrastructure and feature modules.
 *
 * @public
 */
@Module({
  imports: [AppConfigModule, AppLoggerModule, PrismaModule, RedisModule, HealthModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
