/**
 * @file tenants.controller.ts
 * @description HTTP controller for tenant-management endpoints.
 *
 * Demonstrates FCM rows #19 (library decorators) and #20 (multi-tenant isolation):
 * - `@CurrentUser()` extracts the authenticated user without touching `req.user` directly.
 * - `@Roles('OWNER')` uses the library's `RolesGuard` and role hierarchy from auth.config.ts.
 *
 * @layer tenants
 * @see docs/guidelines/nestjs-guidelines.md
 * @see docs/guidelines/nest-auth-guidelines.md
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import { CurrentUser, Roles } from '@bymax-one/nest-auth';
import type { AuthUser } from '@bymax-one/nest-auth';

import { TenantsService } from './tenants.service.js';
import { CreateTenantDto } from './dto/create-tenant.dto.js';

/**
 * Handles `/api/tenants` routes.
 *
 * Both routes require an authenticated JWT (applied globally via `JwtAuthGuard`).
 * `POST /api/tenants` additionally requires the `OWNER` role.
 *
 * @public
 */
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  /**
   * Returns the list of tenants the authenticated user belongs to.
   *
   * Uses `@CurrentUser()` to receive the JWT-decoded user — never accesses
   * `req.user` directly to stay library-faithful.
   *
   * GET /api/tenants/me
   *
   * @param user - Authenticated user injected by `@CurrentUser()`.
   * @returns Array of tenants the user is a member of.
   */
  @Get('me')
  listForMe(@CurrentUser() user: AuthUser): Promise<Tenant[]> {
    return this.tenantsService.listForUser(user.id);
  }

  /**
   * Creates a new tenant workspace.
   *
   * Restricted to `OWNER`-role users via `@Roles('OWNER')` + `RolesGuard`.
   * MEMBERs and VIEWERs receive a 403 from `RolesGuard` before this handler runs.
   *
   * POST /api/tenants
   *
   * @param dto - Validated creation payload.
   * @returns The newly created tenant.
   */
  @Post()
  @Roles('OWNER')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateTenantDto): Promise<Tenant> {
    return this.tenantsService.create(dto);
  }
}
