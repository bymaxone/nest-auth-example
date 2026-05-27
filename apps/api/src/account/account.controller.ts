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

import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService, CurrentUser, SkipMfa, TokenDeliveryService } from '@bymax-one/nest-auth';
import type {
  BearerAuthResponse,
  BothAuthResponse,
  CookieAuthResponse,
  DashboardJwtPayload,
} from '@bymax-one/nest-auth';

import { AccountService } from './account.service.js';
import type { MfaStatusInfo, WorkspaceInfo } from './account.service.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { SwitchWorkspaceDto } from './dto/switch-workspace.dto.js';

/**
 * Handles `/api/account` routes for the currently authenticated user.
 *
 * @public
 */
@Controller('account')
export class AccountController {
  constructor(
    private readonly accountService: AccountService,
    // `AuthService` and `TokenDeliveryService` come from the globally-registered
    // `BymaxAuthModule`. They are public exports of `@bymax-one/nest-auth`
    // (v1.0.10+) — the lib explicitly supports consumer apps composing
    // password-less token-issuance flows (workspace switch, impersonation)
    // on top of `issueTokensForUserId` + `deliverAuthResponse`.
    private readonly authService: AuthService,
    private readonly tokenDelivery: TokenDeliveryService,
  ) {}

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
  @SkipMfa()
  listWorkspaces(@CurrentUser() user: DashboardJwtPayload): Promise<WorkspaceInfo[]> {
    return this.accountService.listWorkspaces(user.sub, user.tenantId);
  }

  /**
   * Returns the MFA status snapshot for the current user. Used by the
   * security page to render the recovery-code counter and to switch
   * between setup / disable cards.
   *
   * The endpoint reads the user's `mfaEnabled` and `mfaRecoveryCodes`
   * fields directly from Postgres — the lib's `GET /api/auth/me` endpoint
   * carries `mfaEnabled` on its JWT-claims projection but does NOT expose
   * the recovery-code count (it would be a structural leak of the storage
   * format). Hence this app-side endpoint.
   *
   * GET /api/account/mfa
   *
   * @param user - Authenticated user injected by `@CurrentUser()`.
   * @returns Snapshot with `enabled`, `recoveryCodesRemaining`, `recoveryCodesTotal`.
   */
  @Get('mfa')
  @SkipMfa()
  getMfaStatus(@CurrentUser() user: DashboardJwtPayload): Promise<MfaStatusInfo> {
    return this.accountService.getMfaStatus(user.sub, user.tenantId);
  }

  /**
   * Silent workspace switch. Issues a full session for the caller's sibling
   * `User` row in the destination tenant (same email, distinct row, distinct
   * password / MFA / role) without forcing a password re-entry.
   *
   * Authorisation is enforced by `AccountService.findSwitchTarget`: the
   * destination row MUST share the caller's email AND be ACTIVE. Without
   * that check this endpoint would let any authenticated user log into any
   * userId — a critical privilege-escalation vector. Even with the check,
   * MFA-enabled destination accounts are rejected with `MFA_REQUIRED` by
   * the lib's `AuthService.issueTokensForUserId`; the frontend handles
   * that by redirecting to `/auth/login?tenantId=<slug>` so the user
   * completes the destination tenant's MFA challenge normally.
   *
   * Cookie delivery is delegated to `TokenDeliveryService.deliverAuthResponse`
   * (newly public in lib v1.0.10) so the cookie attribute set stays in
   * sync with the lib's password-login path — replicating those attributes
   * here would silently drift the moment the lib changes one of them.
   *
   * Decorated with `@SkipMfa()` because the global `MfaRequiredGuard` would
   * otherwise block the call when the CURRENT session is on a tenant where
   * the user has MFA disabled but the destination requires it — the
   * destination MFA gate fires inside `issueTokensForUserId` as the
   * canonical block, not on the current session's posture.
   *
   * POST /api/account/switch-workspace
   *
   * @param dto  - Validated `{ tenantId }` for the destination tenant CUID.
   * @param user - Authenticated user injected by `@CurrentUser()`.
   * @param req  - Incoming Express request (IP, User-Agent for audit).
   * @param res  - Express response in passthrough mode (cookie delivery).
   * @returns The new auth response — shape depends on `tokenDelivery` mode
   *   in `auth.config.ts`; this example uses cookies, so the JSON body
   *   carries only `{ user }` and the access/refresh tokens travel via
   *   `Set-Cookie`.
   * @throws `BadRequestException`   when target == current tenant.
   * @throws `UnauthorizedException` when the caller's account is missing.
   * @throws `NotFoundException`     when the email has no row in the target.
   * @throws `ForbiddenException`    when the target row is not ACTIVE.
   * @throws `AuthException(MFA_REQUIRED)` when the target account has MFA
   *   enabled — the consumer must redirect to the MFA challenge flow.
   */
  @Post('switch-workspace')
  @HttpCode(HttpStatus.OK)
  @SkipMfa()
  async switchWorkspace(
    @Body() dto: SwitchWorkspaceDto,
    @CurrentUser() user: DashboardJwtPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CookieAuthResponse | BearerAuthResponse | BothAuthResponse> {
    // Step 1: validate ownership (email match + ACTIVE in the destination).
    const { targetUserId } = await this.accountService.findSwitchTarget(
      user.sub,
      user.tenantId,
      dto.tenantId,
    );

    // Step 2: issue tokens for the target user via the lib's password-less path.
    // The lib enforces every status guard (suspended / banned / unverified) and
    // throws `MFA_REQUIRED` when the target has MFA — that exception propagates
    // verbatim so the frontend can route the user through the MFA challenge.
    const ip = req.ip ?? '';
    const userAgent = String(req.headers['user-agent'] ?? '');
    const result = await this.authService.issueTokensForUserId(targetUserId, ip, userAgent);

    // Step 3: deliver via the lib's canonical cookie writer. Sets the same
    // attribute set the password-login path uses (httpOnly, secure, sameSite,
    // refreshCookiePath, …) so the browser treats both flows identically.
    return this.tokenDelivery.deliverAuthResponse(res, result, req);
  }
}
