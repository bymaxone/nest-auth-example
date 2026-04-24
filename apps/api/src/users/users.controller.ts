/**
 * @file users.controller.ts
 * @description HTTP controller for user-management endpoints.
 *
 * Demonstrates FCM row #23 (account status enforcement): admins can update
 * a tenant member's status so that `UserStatusGuard` blocks them on their
 * next authenticated request.
 *
 * @layer users
 * @see docs/guidelines/nestjs-guidelines.md
 * @see docs/guidelines/nest-auth-guidelines.md
 */

import { Body, Controller, Headers, Ip, Param, Patch } from '@nestjs/common';
import { CurrentUser, Roles } from '@bymax-one/nest-auth';
import type { AuthUser, SafeAuthUser } from '@bymax-one/nest-auth';

import { UsersService } from './users.service.js';
import { UpdateStatusDto } from './dto/update-status.dto.js';

/**
 * Handles `/api/users` routes.
 *
 * All routes require an authenticated JWT (global `JwtAuthGuard`).
 * Status update is restricted to the `ADMIN` role (and higher by hierarchy).
 *
 * @public
 */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Updates a user's account status within the authenticated admin's tenant.
   *
   * Cross-tenant updates are prevented at the service layer — the target user
   * must belong to the same tenant as the acting admin. If the user does not
   * exist in the admin's tenant, a `404` is returned (anti-enumeration: does
   * not reveal whether the user exists in a different tenant).
   *
   * PATCH /api/users/:id/status
   *
   * @param id - Target user ID from the URL parameter.
   * @param dto - Validated new status.
   * @param admin - Authenticated admin injected by `@CurrentUser()`.
   * @param ip - Client IP address (NestJS built-in `@Ip()` decorator).
   * @param userAgent - `User-Agent` request header for audit logging.
   * @returns The updated user's safe (credential-free) representation.
   */
  @Patch(':id/status')
  @Roles('ADMIN')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() admin: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ): Promise<SafeAuthUser> {
    return this.usersService.updateStatus(
      id,
      dto,
      admin.tenantId,
      admin.id,
      ip ?? '',
      userAgent ?? '',
    );
  }
}
