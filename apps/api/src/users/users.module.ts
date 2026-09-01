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
 */

import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaUserRepository } from '../auth/prisma-user.repository.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/**
 * Self-contained module for tenant-admin user endpoints.
 *
 * Imports `RealtimeModule` so that `UsersService` can call
 * the shared user-connection port when a user's status is
 * changed to a blocked value.
 *
 * @public
 */
@Module({
  // AuthModule re-exports BymaxAuthModule so AuthRedisService is in scope here
  // — UsersService injects it to invalidate the UserStatusGuard cache key
  // (`us:{userId}`) immediately after a status update.
  imports: [PrismaModule, RealtimeModule, AuthModule],
  controllers: [UsersController],
  providers: [UsersService, PrismaUserRepository],
})
export class UsersModule {}
