/**
 * @file tenants.controller.ts
 * @description HTTP controller for tenant-management endpoints.
 *
 * Demonstrates library patterns (decorators and multi-tenant isolation):
 * - `@CurrentUser()` extracts the authenticated user without touching `req.user` directly.
 * - `@Roles('OWNER')` uses the library's `RolesGuard` and role hierarchy from auth.config.ts.
 *
 * @layer tenants
 * @see docs/guidelines/nestjs-guidelines.md
 * @see docs/guidelines/nest-auth-guidelines.md
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import { CurrentUser, Public, Roles } from '@bymax-one/nest-auth';
import type { DashboardJwtPayload } from '@bymax-one/nest-auth';

import { TenantsService } from './tenants.service.js';
import { CreateTenantDto } from './dto/create-tenant.dto.js';
import { ResolveTenantByIdQuery, ResolveTenantBySlugQuery } from './dto/tenant-lookup.dto.js';

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
   * Resolves a tenant slug to its internal CUID.
   *
   * Public endpoint — no authentication required. Used by the login page to
   * convert a `?tenantId=<slug>` URL parameter to the CUID needed in the
   * `X-Tenant-Id` header before the login request is sent.
   *
   * GET /api/tenants/resolve?slug=acme
   *
   * The parameter is validated as a DTO rather than taken as a bare primitive:
   * a missing `slug` would otherwise reach Prisma as `undefined` and surface a
   * driver error as a 500, where the boundary owes the caller a 400.
   *
   * @param query - Validated `{ slug }`.
   * @returns Object with the tenant's `id` (CUID).
   */
  @Public()
  @Get('resolve')
  resolveBySlug(@Query() query: ResolveTenantBySlugQuery): Promise<{ id: string }> {
    return this.tenantsService.resolveBySlug(query.slug);
  }

  /**
   * Resolves a tenant CUID back to its slug.
   *
   * Public for the same reason `resolve` is: the pages that need it run before
   * anyone is signed in. A link mailed by the library carries the tenant as a
   * CUID — that is what `IEmailProvider` receives — while the workspace picker
   * on the login page keys off slugs, so without this mapping a confirmation
   * link for a non-default workspace lands the user on the default one.
   *
   * It exposes nothing new: the slugs are already public, listed in the
   * picker, and `resolve` already maps them the other way.
   *
   * GET /api/tenants/slug?id=c…
   *
   * Validated as a DTO for the same reason `resolve` is, and pinned to the CUID
   * shape: every legitimate caller got this value from a link the app mailed.
   *
   * @param query - Validated `{ id }`.
   * @returns Object with the tenant's `slug`.
   */
  @Public()
  @Get('slug')
  resolveSlugById(@Query() query: ResolveTenantByIdQuery): Promise<{ slug: string }> {
    return this.tenantsService.resolveSlugById(query.id);
  }

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
  listForMe(@CurrentUser() user: DashboardJwtPayload): Promise<Tenant[]> {
    return this.tenantsService.listForUser(user.sub);
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
