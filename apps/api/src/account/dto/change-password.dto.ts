/**
 * @file change-password.dto.ts
 * @description DTO for `POST /api/account/change-password`.
 *
 * Validates both the current password (required for identity confirmation)
 * and the new password (minimum length enforced; upper bound prevents
 * unbounded scrypt CPU time).
 *
 * @layer account
 * @see docs/guidelines/validation-guidelines.md
 */

import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Payload for changing the authenticated user's password.
 *
 * @public
 */
export class ChangePasswordDto {
  /** Current password — verified against the stored scrypt hash before any update. */
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  /**
   * New password.
   *
   * The 8-character minimum matches the registration constraint. The 128-character
   * maximum prevents unbounded scrypt CPU usage on pathologically long inputs.
   */
  @IsString()
  @MinLength(8, { message: 'New password must be at least 8 characters' })
  @MaxLength(128, { message: 'New password must be at most 128 characters' })
  newPassword!: string;
}
