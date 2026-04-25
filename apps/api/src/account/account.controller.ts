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

import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '@bymax-one/nest-auth';
import type { AuthUser } from '@bymax-one/nest-auth';

import { AccountService } from './account.service.js';
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
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: AuthUser): Promise<void> {
    return this.accountService.changePassword(user.id, user.tenantId, dto);
  }
}
