/**
 * @file platform.module.ts
 * @description NestJS module for the platform admin context.
 *
 * Registers `PlatformController` and `PlatformService` and imports `PrismaModule`
 * so the service can query tenants, users, and audit logs directly.
 *
 * This module does NOT import `AuthModule` — guards and decorators are imported
 * from `@bymax-one/nest-auth` directly in the controller. This avoids a circular
 * dependency and keeps the platform boundary clean.
 *
 * Covers FCM row #22 (Platform admin context).
 *
 * @layer platform
 * @see docs/guidelines/nestjs-guidelines.md
 * @see docs/DEVELOPMENT_PLAN.md §Phase 9 P9-2
 */

import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module.js';
import { PlatformController } from './platform.controller.js';
import { PlatformService } from './platform.service.js';

/**
 * Module that exposes platform admin endpoints under `/api/platform`.
 *
 * Contains no auth business logic — it delegates to `@bymax-one/nest-auth`
 * guards for authentication and authorization.
 *
 * @public
 */
@Module({
  imports: [PrismaModule],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
