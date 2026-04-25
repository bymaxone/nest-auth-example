/**
 * @file list-users.dto.ts
 * @description Query-parameter DTO for `GET /api/platform/users?tenantId=...`.
 *
 * The `tenantId` query parameter scopes the user listing to a specific tenant.
 * Platform admins may query any tenant — no tenant-level authorization is applied
 * here (the `JwtPlatformGuard` + `PlatformRolesGuard` handle context authorization).
 *
 * @layer platform
 * @see docs/guidelines/validation-guidelines.md
 * @see docs/DEVELOPMENT_PLAN.md §Phase 9 P9-2
 */

import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Validated query parameters for listing users within a specific tenant.
 *
 * The `tenantId` is a required filter — platform admins must explicitly scope
 * their query to a tenant, preventing accidental full-table scans.
 *
 * @public
 */
export class ListUsersDto {
  /**
   * ID of the tenant whose users to list.
   *
   * Must be a non-empty string matching a `Tenant.id` in the database.
   * The service does not validate tenant existence — a missing tenant yields
   * an empty array (consistent with Prisma `findMany` semantics).
   */
  @IsString()
  @IsNotEmpty({ message: 'tenantId must not be empty' })
  @MaxLength(40)
  tenantId!: string;
}
