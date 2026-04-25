/**
 * @file update-user-status.dto.ts
 * @description Body DTO for `PATCH /api/platform/users/:id/status`.
 *
 * Mirrors `apps/api/src/users/dto/update-status.dto.ts` but lives in the
 * platform layer because the semantics differ: a platform admin mutates any
 * user across all tenants, while the tenant admin DTO is scoped to the admin's
 * own tenant.
 *
 * @layer platform
 * @see docs/guidelines/validation-guidelines.md
 * @see docs/DEVELOPMENT_PLAN.md §Phase 9 P9-2
 */

import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { UserStatus } from '@prisma/client';

/**
 * Allowed status values derived from the Prisma `UserStatus` enum so the list
 * stays in sync with the schema automatically when new statuses are added.
 */
export const ALLOWED_USER_STATUSES = Object.values(UserStatus) as [UserStatus, ...UserStatus[]];

/**
 * Payload for a platform admin's user status update.
 *
 * Requires `SUPER_ADMIN` platform role (enforced at the controller level via
 * the `@PlatformRoles('SUPER_ADMIN')` method-level override on the PATCH handler).
 *
 * @public
 */
export class UpdateUserStatusDto {
  /**
   * New account status to assign to the target user.
   *
   * Setting `SUSPENDED`, `BANNED`, or `INACTIVE` blocks the user's next
   * authenticated request via `UserStatusGuard` (global guard in `AppModule`).
   */
  @IsString()
  @IsNotEmpty()
  @IsIn(ALLOWED_USER_STATUSES, {
    message: `status must be one of: ${Object.values(UserStatus).join(', ')}`,
  })
  status!: UserStatus;
}
