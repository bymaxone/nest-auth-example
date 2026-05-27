/**
 * @file audit.controller.ts
 * @description Read-only HTTP surface for the audit log viewer at
 * `/dashboard/audit`. Admin-gated via `@Roles('ADMIN')` (OWNER inherits
 * by hierarchy) so members can't snoop on other users' actions.
 *
 * No POST/PUT/DELETE: the audit ledger is append-only, written
 * exclusively by `AppAuthHooks` from inside the lib's lifecycle
 * callbacks.
 *
 * @layer audit
 * @see docs/guidelines/nestjs-guidelines.md
 */

import { Controller, Get } from '@nestjs/common';
import { CurrentUser, Roles } from '@bymax-one/nest-auth';
import type { DashboardJwtPayload } from '@bymax-one/nest-auth';

import { AuditService } from './audit.service.js';
import type { AuditEntry } from './audit.service.js';

/**
 * Handles `/api/audit` routes for the dashboard audit log viewer.
 *
 * @public
 */
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * Returns the most recent audit entries for the authenticated user's
   * tenant. Admin / OWNER only — RBAC enforced by the lib's
   * `RolesGuard` via `@Roles('ADMIN')`.
   *
   * GET /api/audit
   *
   * @param user - Authenticated user injected by `@CurrentUser()`.
   * @returns Up to 100 entries, newest first.
   */
  @Get()
  @Roles('ADMIN')
  listRecent(@CurrentUser() user: DashboardJwtPayload): Promise<AuditEntry[]> {
    return this.auditService.listRecent(user.tenantId);
  }
}
