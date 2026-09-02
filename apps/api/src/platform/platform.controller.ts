/**
 * @file platform.controller.ts
 * @description HTTP controller for platform admin endpoints.
 *
 * Demonstrates platform admin capabilities: a platform super-admin can list all
 * tenants, list users in any tenant, and mutate a user's status across tenant
 * boundaries — capabilities that the tenant-scoped `UsersController` intentionally
 * does not allow.
 *
 * Guard pipeline (applied at class level):
 *   1. `JwtPlatformGuard` — verifies the platform-specific JWT cookie. Rejects
 *      tenant JWTs (different issuer/payload shape).
 *   2. `PlatformRolesGuard` — enforces the `@PlatformRoles(...)` metadata.
 * This order mirrors the global guard order but is explicit here because platform
 * routes are NOT covered by the globally registered `JwtAuthGuard`.
 *
 * Platform routes bypass `tenantIdResolver` — the `X-Tenant-Id` header is neither
 * required nor inspected for any route in this controller.
 *
 * @layer platform
 * @see docs/guidelines/nestjs-guidelines.md
 * @see docs/guidelines/nest-auth-guidelines.md §Decorators & guards
 */

import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentUser,
  JwtPlatformGuard,
  PlatformRoles,
  PlatformRolesGuard,
} from '@bymax-one/nest-auth';
import type { PlatformJwtPayload } from '@bymax-one/nest-auth';
import type { Tenant } from '@prisma/client';

import { SkipJwtAuth } from '../auth/skip-jwt-auth.decorator.js';
import { PlatformService } from './platform.service.js';
import type { PlatformSafeUser } from './platform.service.js';
import { ListUsersDto } from './dto/list-users.dto.js';
import { UpdateUserStatusDto } from './dto/update-user-status.dto.js';

/**
 * Platform admin endpoints under `/api/platform`.
 *
 * Every route requires a valid platform JWT (`JwtPlatformGuard`) and at least
 * `SUPPORT` platform role (`PlatformRolesGuard`). Tenant JWTs are rejected.
 *
 * @public
 */
@Controller('platform')
// @SkipJwtAuth bypasses ONLY the global cookie-JWT guard so JwtPlatformGuard
// can authenticate via the platform bearer token. The previous @Public() also
// disabled JwtPlatformGuard, leaving these routes unauthenticated.
@SkipJwtAuth()
@UseGuards(JwtPlatformGuard, PlatformRolesGuard)
@PlatformRoles('SUPER_ADMIN', 'SUPPORT')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  /**
   * Lists all tenants in the system, ordered by creation date.
   *
   * Accessible to both `SUPER_ADMIN` and `SUPPORT` roles — read-only.
   *
   * GET /api/platform/tenants
   *
   * @returns Array of all tenant records.
   */
  @Get('tenants')
  listTenants(): Promise<Tenant[]> {
    return this.platformService.listTenants();
  }

  /**
   * Lists all users in the specified tenant, with credentials stripped.
   *
   * The `tenantId` query parameter is validated by `ListUsersDto` (class-validator
   * via the global `ValidationPipe`). A missing tenant yields an empty array.
   *
   * GET /api/platform/users?tenantId=...
   *
   * @param dto - Validated query parameters containing `tenantId`.
   * @returns Array of safe user objects (no `passwordHash`, `mfaSecret`, etc.).
   */
  @Get('users')
  listUsers(@Query() dto: ListUsersDto): Promise<PlatformSafeUser[]> {
    return this.platformService.listUsers(dto.tenantId);
  }

  /**
   * Updates a user's account status from the platform context.
   *
   * Unlike the tenant-admin endpoint (`PATCH /api/users/:id/status`), this
   * operation crosses tenant boundaries. Writes a `platform.user.status_changed`
   * audit log entry with the acting platform user's ID.
   *
   * Restricted to `SUPER_ADMIN` only (overrides the class-level `SUPPORT` grant)
   * because this is a write operation that can reinstate banned or suspended users.
   * `SUPPORT` is intentionally read-only (list tenants and users).
   *
   * PATCH /api/platform/users/:id/status
   *
   * @param id - Target user ID from the URL parameter.
   * @param dto - Validated new status.
   * @param platformUser - Platform JWT payload injected by `@CurrentUser()`; the
   *   acting admin's id is `sub`, not `id` — the guard puts the token payload on
   *   the request, never the persisted `AuthPlatformUser` row.
   * @param ip - Client IP address for the audit entry.
   * @param userAgent - `User-Agent` header for the audit entry.
   * @returns The updated user as a safe object (no credentials).
   * @throws `NotFoundException` when the target user does not exist.
   */
  @Patch('users/:id/status')
  @PlatformRoles('SUPER_ADMIN')
  updateUserStatus(
    // Prisma's User.id is a CUID (`@default(cuid())`), not a UUID v4. Validation
    // is left to the persistence layer, which throws NotFoundException when no
    // row matches the supplied id — no shape coercion is needed at the boundary.
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() platformUser: PlatformJwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ): Promise<PlatformSafeUser> {
    return this.platformService.updateUserStatus(
      id,
      dto,
      platformUser.sub,
      ip ?? '',
      userAgent ?? '',
    );
  }

  /**
   * Administratively resets a tenant user's MFA from the platform context.
   *
   * Demonstrates the library's `MfaService.resetMfa` (lib v1.2.0+): the support
   * path for "lost device AND lost recovery codes" after out-of-band identity
   * verification. The library clears the MFA state, revokes every session,
   * bumps the token epoch, and notifies the account owner by email. Writes a
   * `platform.user.mfa_reset` audit entry with the acting admin's ID.
   *
   * Restricted to `SUPER_ADMIN` — like the status mutation, this is a write
   * that weakens an account's protections; `SUPPORT` stays read-only.
   *
   * POST /api/platform/users/:id/reset-mfa
   *
   * @param id - Target user ID from the URL parameter.
   * @param platformUser - Platform JWT payload injected by `@CurrentUser()`; the
   *   acting admin's id is `sub`, not `id` — the guard puts the token payload on
   *   the request, never the persisted `AuthPlatformUser` row.
   * @param ip - Client IP address for the audit entry.
   * @param userAgent - `User-Agent` header for the audit entry.
   * @returns The updated user as a safe object (`mfaEnabled: false`).
   * @throws `NotFoundException` when the target user does not exist.
   */
  @Post('users/:id/reset-mfa')
  @PlatformRoles('SUPER_ADMIN')
  resetUserMfa(
    @Param('id') id: string,
    @CurrentUser() platformUser: PlatformJwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ): Promise<PlatformSafeUser> {
    return this.platformService.resetUserMfa(id, platformUser.sub, ip ?? '', userAgent ?? '');
  }
}
