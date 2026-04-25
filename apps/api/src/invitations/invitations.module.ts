/**
 * @file invitations.module.ts
 * @description NestJS module for tenant invitation management.
 *
 * Imports `AuthModule` to access `BYMAX_AUTH_EMAIL_PROVIDER` (exported from
 * `BymaxAuthModule`). The `BYMAX_AUTH_REDIS_CLIENT` is provided globally by
 * the `@Global() RedisModule` and does not need a separate import.
 *
 * @layer invitations
 * @see docs/DEVELOPMENT_PLAN.md §Phase 14 P14-6
 */

import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';

/**
 * Self-contained module for tenant invitation endpoints.
 *
 * @public
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [InvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
