/**
 * @file debug.module.ts
 * @description Dev-only NestJS module that registers `DebugController`.
 *
 * This module is imported in `AppModule` only when `NODE_ENV !== 'production'`.
 * In production the module is never instantiated — fail-closed design so no
 * debug surface is exposed to live traffic.
 *
 * `BYMAX_AUTH_REDIS_CLIENT` is available globally via `RedisModule` (marked
 * `@Global()`), so it does not need to be re-imported here.
 *
 * @layer debug
 * @see debug.controller.ts
 * @see docs/DEVELOPMENT_PLAN.md §Phase 7 P7-5
 */

import { Module } from '@nestjs/common';

import { DebugController } from './debug.controller.js';

/**
 * Self-contained debug module.
 *
 * Only registered in development and test environments — see `AppModule` for
 * the conditional import guard.
 *
 * @public
 */
@Module({
  controllers: [DebugController],
})
export class DebugModule {}
