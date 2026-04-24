/**
 * @file health.module.ts
 * @description NestJS module that registers the upgraded health-check controller.
 *
 * Phase 5 additions:
 * - Imports `PrismaModule` to give `HealthController` access to `PrismaService`.
 * - The Redis client is injected via the global `RedisModule` registered in `AppModule`;
 *   no explicit import is required here.
 * - Registers `ThrottlerModule.forRoot` locally so `GET /api/health/throttle-demo`
 *   can exercise `@Throttle(AUTH_THROTTLE_CONFIGS.login)` in isolation.
 *   Phase 7 will migrate throttle registration to `AppModule` as a global guard.
 *
 * @layer infrastructure
 */

import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { PrismaModule } from '../prisma/prisma.module.js';
import { HealthController } from './health.controller.js';

/**
 * Health-check module.
 *
 * Exposes:
 * - `GET /api/health` — aggregate Postgres + Redis readiness probe.
 * - `GET /api/health/throttle-demo` — throttle demonstration (FCM row #17).
 *
 * The Redis client (`BYMAX_AUTH_REDIS_CLIENT`) is resolved via the global
 * `RedisModule`; `PrismaService` is resolved via the explicit `PrismaModule` import.
 *
 * @public
 */
@Module({
  imports: [
    PrismaModule,
    // Base throttler config required for @Throttle decorator to function.
    // Route-level @Throttle(AUTH_THROTTLE_CONFIGS.login) overrides this default.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
  ],
  controllers: [HealthController],
})
export class HealthModule {}
