/**
 * @file account.controller.ts
 * @description HTTP controller for the authenticated user's own account endpoints.
 *
 * All routes are protected by the global `JwtAuthGuard` + `UserStatusGuard` pipeline
 * registered in `AppModule`. No additional `@Roles()` decorator is needed — any
 * authenticated, active user may manage their own account.
 *
 * @layer account
 * @see docs/guidelines/nestjs-guidelines.md
 * @see docs/guidelines/nest-auth-guidelines.md
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '@bymax-one/nest-auth';
import type { DashboardJwtPayload } from '@bymax-one/nest-auth';

import { AccountService } from './account.service.js';
import type { WorkspaceInfo } from './account.service.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';

/**
 * Handles `/api/account` routes for the currently authenticated user.
 *
 * @public
 */
@Controller('account')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  /**
   * Changes the authenticated user's password.
   *
   * Verifies `currentPassword` against the stored scrypt hash before replacing
   * it with a hash of `newPassword`. Returns `204 No Content` on success.
   *
   * POST /api/account/change-password
   *
   * @param dto  - Validated `currentPassword` + `newPassword`.
   * @param user - Authenticated user injected by `@CurrentUser()`.
   */
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: DashboardJwtPayload,
  ): Promise<void> {
    return this.accountService.changePassword(user.sub, user.tenantId, dto);
  }

  /**
   * Lists every workspace (tenant) the current user's email has an active
   * account in. Powers the workspace switcher in the dashboard topbar.
   *
   * The library binds one JWT to one tenant; "switching" therefore means
   * signing out and signing back in to the destination tenant. The frontend
   * uses this list to render the dropdown and to drive the re-auth redirect.
   *
   * GET /api/account/workspaces
   *
   * @param user - Authenticated user injected by `@CurrentUser()`.
   * @returns Workspaces sorted with the current one first, then alphabetically.
   */
  @Get('workspaces')
  listWorkspaces(@CurrentUser() user: DashboardJwtPayload): Promise<WorkspaceInfo[]> {
    return this.accountService.listWorkspaces(user.sub, user.tenantId);
  }
}
