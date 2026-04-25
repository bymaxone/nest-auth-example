/**
 * @file account.module.ts
 * @description NestJS module for the authenticated user's own account management.
 *
 * Imports `PrismaModule` for direct database access in `AccountService`.
 * The global guards in `AppModule` (JwtAuthGuard → UserStatusGuard → MfaRequiredGuard →
 * RolesGuard) automatically protect all routes in this module — no per-route
 * guard configuration is required.
 *
 * @layer account
 * @see docs/DEVELOPMENT_PLAN.md §Phase 14 P14-2
 */

import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';

/**
 * Self-contained module for the current user's account endpoints.
 *
 * @public
 */
@Module({
  imports: [PrismaModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
