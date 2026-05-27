/**
 * @file switch-workspace.dto.ts
 * @description Validated payload for `POST /api/account/switch-workspace`.
 *
 * The caller is already authenticated; they ask to switch into a different
 * tenant where their email also has an ACTIVE `User` row. The service
 * validates the email-match ownership rule before invoking the lib's
 * `AuthService.issueTokensForUserId` to mint a new session for the target
 * user without a password.
 *
 * `tenantId` is the destination tenant's CUID (not the slug) — the frontend
 * `TenantSwitcher` already has the CUID in hand because `listWorkspaces`
 * returns it. Accepting the slug instead would force the API into another
 * lookup; accepting both would let a caller probe slug → CUID mappings.
 *
 * @layer account/dto
 */

import { IsString, Length, Matches } from 'class-validator';

/**
 * Body shape for the silent workspace-switch endpoint.
 *
 * @public
 */
export class SwitchWorkspaceDto {
  /**
   * Destination tenant CUID. Must be a CUID (24 lowercase alphanumeric
   * characters starting with `c`) so a stray slug or arbitrary string
   * cannot reach the service-layer Prisma query.
   */
  @IsString()
  @Length(24, 30)
  @Matches(/^c[a-z0-9]+$/, { message: 'tenantId must be a CUID' })
  tenantId!: string;
}
