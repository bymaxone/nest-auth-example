/**
 * @file debug.module.ts
 * @description Dev-only NestJS module that registers `DebugController`.
 *
 * This module is imported in `AppModule` only when `NODE_ENV !== 'production'`.
 * In production the module is never instantiated — fail-closed design so no
 * debug surface is exposed to live traffic.
 *
 * Imports `AuthModule` (which re-exports `BymaxAuthModule`) so the library's
 * `AuthService` is injectable into the controller — the lockout demo drives
 * the real login/lockout path instead of poking Redis internals.
 *
 * @layer debug
 * @see debug.controller.ts
 */

import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
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
  imports: [AuthModule],
  controllers: [DebugController],
})
export class DebugModule {}
