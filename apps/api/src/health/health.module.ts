/**
 * @file health.module.ts
 * @description NestJS module that registers the health-check controller.
 *
 * Imported by `AppModule`. Upgraded in Phase 5 to expose Postgres + Redis indicators.
 *
 * @layer infrastructure
 */

import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';

/**
 * Self-contained health-check module.
 *
 * Exposes `GET /api/health` with no external dependencies in Phase 3.
 * @public
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
