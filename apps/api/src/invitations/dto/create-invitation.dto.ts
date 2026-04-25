/**
 * @file create-invitation.dto.ts
 * @description DTO for `POST /api/invitations`.
 *
 * @layer invitations
 * @see docs/guidelines/validation-guidelines.md
 */

import { IsEmail, IsIn, IsNotEmpty, IsString } from 'class-validator';

/** Roles that can be assigned via invitation. */
export const INVITABLE_ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

/**
 * Payload for creating a tenant invitation.
 *
 * @public
 */
export class CreateInvitationDto {
  /** Email address of the person to invite. */
  @IsEmail()
  email!: string;

  /**
   * Role to assign on acceptance. The inviter must hold a role that is equal
   * to or higher than the requested role (enforced at the service layer).
   */
  @IsString()
  @IsNotEmpty()
  @IsIn(INVITABLE_ROLES, {
    message: `role must be one of: ${INVITABLE_ROLES.join(', ')}`,
  })
  role!: InvitableRole;
}
