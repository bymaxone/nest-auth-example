/**
 * @file health.module.ts
 * @description NestJS module that registers the upgraded health-check controller.
 *
 * Imports `PrismaModule` to give `HealthController` access to `PrismaService`.
 * The Redis client is injected via the global `RedisModule` registered in `AppModule`;
 * no explicit import is required here.
 * Throttling for `GET /api/health/throttle-demo` comes from the app-wide
 * `ThrottlerModule` and guard registered in `AppModule`; this module only
 * narrows the tier through the route's own `@Throttle` decorator.
 *
 * @layer infrastructure
 */

import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module.js';
import { HealthController } from './health.controller.js';

/**
 * Health-check module.
 *
 * Exposes:
 * - `GET /api/health` — aggregate Postgres + Redis readiness probe.
 * - `GET /api/health/throttle-demo` — IP-based rate-limiting demonstration.
 *
 * The Redis client (`BYMAX_AUTH_REDIS_CLIENT`) is resolved via the global
 * `RedisModule`; `PrismaService` is resolved via the explicit `PrismaModule` import.
 *
 * @public
 */
@Module({
  // No local `ThrottlerModule.forRoot` here. The module is global, so a second
  // registration would stand up a second storage: the guard would count against
  // one instance while anything resolving `ThrottlerStorage` from the root
  // injector — a test clearing counters between cases, for one — would hold the
  // other. `AppModule`'s registration is the only one, and the route-level
  // `@Throttle(AUTH_THROTTLE_CONFIGS.login)` still overrides its default tier.
  imports: [PrismaModule],
  controllers: [HealthController],
})
export class HealthModule {}
