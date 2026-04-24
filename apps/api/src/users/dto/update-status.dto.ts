/**
 * @file update-status.dto.ts
 * @description DTO for `PATCH /api/users/:id/status`.
 *
 * The allowed values mirror the `UserStatus` Prisma enum. Using an explicit
 * `IsIn` constraint (rather than `@IsEnum(UserStatus)`) keeps this layer
 * decoupled from Prisma's generated types and makes the allowed values
 * explicit in validation error messages.
 *
 * @layer users
 * @see docs/guidelines/validation-guidelines.md
 */

import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { UserStatus } from '@prisma/client';

/**
 * Allowed user status values derived from the Prisma `UserStatus` enum so the
 * list stays in sync with the schema automatically — no manual update required
 * when new statuses are added to `prisma/schema.prisma`.
 */
export const ALLOWED_USER_STATUSES = Object.values(UserStatus) as [UserStatus, ...UserStatus[]];

export type AllowedUserStatus = UserStatus;

/**
 * Payload for updating a user's account status.
 *
 * Only `ADMIN`-role users (and OWNER by hierarchy) may call this endpoint.
 *
 * @public
 */
export class UpdateStatusDto {
  /**
   * New account status.
   *
   * `SUSPENDED`, `BANNED`, and `INACTIVE` are blocked by `UserStatusGuard` on
   * the user's next authenticated request.
   */
  @IsString()
  @IsNotEmpty()
  @IsIn(ALLOWED_USER_STATUSES, {
    message: `status must be one of: ${Object.values(UserStatus).join(', ')}`,
  })
  status!: AllowedUserStatus;
}
