/**
 * @file invitations.controller.ts
 * @description HTTP controller for tenant invitation management.
 *
 * All routes are protected by the global `JwtAuthGuard` + `UserStatusGuard`.
 * Listing is available to all authenticated users. Creating and revoking
 * invitations requires the `ADMIN` role (or higher via hierarchy).
 *
 * @layer invitations
 * @see docs/guidelines/nestjs-guidelines.md
 * @see docs/guidelines/nest-auth-guidelines.md
 */

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '@bymax-one/nest-auth';
import type { AuthUser } from '@bymax-one/nest-auth';

import { InvitationsService } from './invitations.service.js';
import type { InvitationRecord } from './invitations.service.js';
import { CreateInvitationDto } from './dto/create-invitation.dto.js';

/**
 * Handles `/api/invitations` routes.
 *
 * @public
 */
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  /**
   * Returns all pending, non-expired invitations for the authenticated user's tenant.
   *
   * GET /api/invitations
   *
   * @param user - Authenticated user injected by `@CurrentUser()`.
   */
  @Get()
  list(@CurrentUser() user: AuthUser): Promise<InvitationRecord[]> {
    return this.invitationsService.listByTenant(user.tenantId);
  }

  /**
   * Creates a new invitation and emails the invitee.
   *
   * Restricted to `ADMIN` role and higher (enforced by `@Roles`).
   * The service also validates that the inviter's role is at least as high
   * as the requested role.
   *
   * POST /api/invitations
   *
   * @param dto  - Validated email + role.
   * @param user - Authenticated admin injected by `@CurrentUser()`.
   */
  @Post()
  @Roles('ADMIN')
  create(
    @Body() dto: CreateInvitationDto,
    @CurrentUser() user: AuthUser,
  ): Promise<InvitationRecord> {
    return this.invitationsService.create(user.id, user.tenantId, dto);
  }

  /**
   * Revokes a pending invitation (deletes the Prisma record; Redis expires naturally).
   *
   * Restricted to `ADMIN` role and higher. Returns `204 No Content` on success.
   *
   * DELETE /api/invitations/:id
   *
   * @param id   - Invitation ID from the URL.
   * @param user - Authenticated admin injected by `@CurrentUser()`.
   */
  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.invitationsService.revoke(id, user.tenantId);
  }
}
