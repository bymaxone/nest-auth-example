/**
 * @file users.module.ts
 * @description NestJS module for tenant-admin user-management endpoints.
 *
 * Imports `PrismaModule` for database access in `UsersService`. Re-uses
 * `PrismaUserRepository` from the `auth/` layer — it is the authoritative
 * persistence layer for user records and is shared across modules that
 * need user reads/writes without duplicating Prisma logic.
 *
 * @layer users
 * @see docs/DEVELOPMENT_PLAN.md §Phase 7 P7-6
 */

import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaUserRepository } from '../auth/prisma-user.repository.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/**
 * Self-contained module for tenant-admin user endpoints.
 *
 * Imports `NotificationsModule` so that `UsersService` can call
 * `NotificationsGateway.maybeDisconnectBlockedUser` when a user's status is
 * changed to a blocked value (FCM row #24 — suspend disconnects the WS session).
 *
 * @public
 */
@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [UsersController],
  providers: [UsersService, PrismaUserRepository],
})
export class UsersModule {}
