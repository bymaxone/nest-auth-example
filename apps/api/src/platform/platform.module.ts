/**
 * @file platform.module.ts
 * @description NestJS module for the platform admin context.
 *
 * Registers `PlatformController` and `PlatformService` and imports `PrismaModule`
 * so the service can query tenants, users, and audit logs directly.
 *
 * Imports `AuthModule` (which re-exports `BymaxAuthModule`) so that
 * `JwtPlatformGuard` and `PlatformRolesGuard` singleton instances created inside
 * `BymaxAuthModule` are available for `@UseGuards()` in `PlatformController`.
 *
 *
 * @layer platform
 * @see docs/guidelines/nestjs-guidelines.md
 */

import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PlatformController } from './platform.controller.js';
import { PlatformService } from './platform.service.js';

/**
 * Module that exposes platform admin endpoints under `/api/platform`.
 *
 * Contains no auth business logic — it delegates to `@bymax-one/nest-auth`
 * guards for authentication and authorization.
 *
 * Imports the shared `RealtimeModule` so `PlatformService` can close a user's
 * live connections after an administrative MFA reset without depending on the
 * notifications feature directly.
 *
 * @public
 */
@Module({
  imports: [AuthModule, PrismaModule, RealtimeModule],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
