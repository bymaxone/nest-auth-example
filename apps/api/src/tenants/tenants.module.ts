/**
 * @file tenants.module.ts
 * @description NestJS module for tenant-management features.
 *
 * Imports `PrismaModule` to make `PrismaService` available for `TenantsService`.
 * Does not import `AuthModule` — library guards and decorators are already
 * available globally via the `APP_GUARD` providers registered in `AppModule`.
 *
 * @layer tenants
 * @see docs/DEVELOPMENT_PLAN.md §Phase 7 P7-3
 */

import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module.js';
import { TenantsController } from './tenants.controller.js';
import { TenantsService } from './tenants.service.js';

/**
 * Self-contained module for tenant endpoints.
 *
 * @public
 */
@Module({
  imports: [PrismaModule],
  controllers: [TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
