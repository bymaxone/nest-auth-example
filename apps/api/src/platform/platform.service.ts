/**
 * @file platform.service.ts
 * @description Business logic for the platform admin endpoints.
 *
 * Platform admins operate above tenant boundaries — queries here are NOT scoped
 * by `tenantId`. The authorization layer (JwtPlatformGuard + PlatformRolesGuard)
 * ensures only authenticated SUPER_ADMIN / SUPPORT users reach this service.
 *
 * Audit logging:
 * - Every mutation writes an `AuditLog` row with `tenantId: null` (platform events
 *   are tenantless), `actorPlatformUserId`, and a structured payload.
 * - Audit writes are non-blocking: a failure is logged and swallowed so that a
 *   transient DB issue never aborts a successful status mutation.
 *
 * Credential safety:
 * - `passwordHash`, `mfaSecret`, and `mfaRecoveryCodes` are NEVER included in any
 *   field returned by this service. All user reads use an explicit `select` block.
 *
 * Covers FCM row #22 (Platform admin context).
 *
 * @layer platform
 * @see docs/guidelines/nestjs-guidelines.md
 * @see docs/guidelines/observability-guidelines.md
 * @see docs/DEVELOPMENT_PLAN.md §Phase 9 P9-2
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tenant } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateUserStatusDto } from './dto/update-user-status.dto.js';

/**
 * Prisma `select` block that produces safe user rows.
 *
 * Only lists fields that ARE returned. Prisma's `select` excludes everything
 * not explicitly set to `true` — credential fields are absent by omission.
 */
const SAFE_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  tenantId: true,
  emailVerified: true,
  mfaEnabled: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  // passwordHash, mfaSecret, mfaRecoveryCodes, oauthProvider, oauthProviderId
  // are excluded by omission — never included in platform API responses.
} as const satisfies Prisma.UserSelect;

/**
 * Safe user shape for platform API responses.
 *
 * Derived directly from `SAFE_USER_SELECT` via `Prisma.UserGetPayload` so any
 * field added to the select is automatically reflected in the return type —
 * eliminating the risk of the manual type silently drifting from the query.
 * Credential fields (`passwordHash`, `mfaSecret`, etc.) are excluded by omission.
 */
export type PlatformSafeUser = Prisma.UserGetPayload<{ select: typeof SAFE_USER_SELECT }>;

/**
 * Service that exposes platform-level administrative operations.
 *
 * All methods are free of tenant isolation constraints because platform admins
 * have global visibility by design. Each mutation is audited.
 *
 * @public
 */
@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns up to 500 tenants ordered by creation date (oldest first).
   *
   * The hard `take` cap prevents unbounded result sets. Cursor-based pagination
   * will be added in a follow-up phase once the front-end requires it.
   *
   * @returns Array of `Tenant` rows (safe — no credential fields on Tenant).
   */
  listTenants(): Promise<Tenant[]> {
    return this.prisma.tenant.findMany({ orderBy: { createdAt: 'asc' }, take: 500 });
  }

  /**
   * Returns up to 500 users belonging to a specific tenant, with credentials stripped.
   *
   * A missing tenant yields an empty array (consistent with `findMany` semantics).
   * The `take` cap prevents unbounded result sets; cursor-based pagination will be
   * added in a follow-up phase.
   *
   * @param tenantId - ID of the tenant to query.
   * @returns Array of safe user objects (no `passwordHash`, `mfaSecret`, etc.).
   */
  listUsers(tenantId: string): Promise<PlatformSafeUser[]> {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: SAFE_USER_SELECT,
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
  }

  /**
   * Updates a user's account status and writes a platform audit log entry.
   *
   * Unlike the tenant-scoped status update in `UsersService`, this operation
   * crosses tenant boundaries (the `where` clause does not include `tenantId`).
   * The audit row records the acting platform user's ID so the change is traceable.
   *
   * @param targetUserId - ID of the `User` row to update.
   * @param dto - Validated new status.
   * @param actorPlatformUserId - ID of the platform admin performing the update.
   * @param ip - Client IP address for the audit entry.
   * @param userAgent - `User-Agent` header for the audit entry.
   * @returns The updated user as a `PlatformSafeUser` (no credentials).
   * @throws `NotFoundException` when the target user does not exist.
   */
  async updateUserStatus(
    targetUserId: string,
    dto: UpdateUserStatusDto,
    actorPlatformUserId: string,
    ip: string,
    userAgent: string,
  ): Promise<PlatformSafeUser> {
    // SERIALIZABLE isolation is required here: READ COMMITTED would allow two
    // concurrent callers to both read the same `previousStatus` before either
    // commits its update, producing an audit entry that misrepresents the actual
    // state transition chain. SERIALIZABLE guarantees the read → update sequence
    // is linearized so each audit row records the exact preceding state.
    const [updated, previousStatus] = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.user.findUnique({
          where: { id: targetUserId },
          select: { id: true, status: true },
        });

        if (!existing) {
          throw new NotFoundException(`User '${targetUserId}' not found`);
        }

        const prev = existing.status;

        const result = await tx.user.update({
          where: { id: targetUserId },
          data: { status: dto.status },
          select: SAFE_USER_SELECT,
        });

        return [result, prev] as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Write audit log AFTER the transaction commits — non-blocking: a write
    // failure must not roll back the status update.
    try {
      await this.prisma.auditLog.create({
        data: {
          // tenantId is null for platform-level events (design invariant).
          tenantId: null,
          actorUserId: null,
          actorPlatformUserId,
          event: 'platform.user.status_changed',
          payload: {
            targetUserId,
            previousStatus,
            newStatus: dto.status,
          } satisfies Prisma.InputJsonValue,
          ip,
          userAgent,
        },
      });
    } catch (err: unknown) {
      this.logger.error({
        msg: 'AuditLog write failed for platform.user.status_changed',
        targetUserId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return updated;
  }
}
