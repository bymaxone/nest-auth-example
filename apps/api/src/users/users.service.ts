/**
 * @file users.service.ts
 * @description Business logic for user-management operations available to
 * tenant admins (status updates, audit logging).
 *
 * The audit log entry is written directly via `PrismaService` in this service
 * rather than through `AppAuthHooks`, which is an acceptable "equivalent direct
 * write" explicitly permitted by the development plan §P7-6.
 * `AppAuthHooks` owns lifecycle hooks fired by the auth library; this service
 * owns admin-initiated mutations that are outside the library's responsibility.
 *
 * @layer users
 * @see docs/guidelines/nestjs-guidelines.md
 * @see docs/DEVELOPMENT_PLAN.md §Phase 7 P7-6
 */

import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { SafeAuthUser } from '@bymax-one/nest-auth';

import { PrismaUserRepository } from '../auth/prisma-user.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsGateway } from '../notifications/notifications.gateway.js';
import type { UpdateStatusDto } from './dto/update-status.dto.js';

/**
 * Safe user representation returned from list and status-update endpoints.
 * Mirrors the fields exposed by the `TenantUserInfo` interface on the frontend.
 *
 * @public
 */
export interface TenantUserRecord {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  createdAt: Date;
}

/**
 * Service that handles user-admin operations.
 *
 * Only exposes operations that are safe for tenant admins to perform.
 * Platform-level user management lives in `platform/` (Phase 9).
 *
 * @public
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly userRepository: PrismaUserRepository,
    private readonly prisma: PrismaService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  /**
   * Updates a user's account status and records the change in the audit log.
   *
   * Tenant isolation is enforced by looking up the user with `(id, tenantId)` —
   * a user in a different tenant returns `null` and produces a 404, preventing
   * cross-tenant enumeration via distinct error codes.
   *
   * @param targetUserId - ID of the user whose status to change.
   * @param dto - Validated new status.
   * @param adminTenantId - Tenant of the acting admin (used for scoping + audit).
   * @param adminUserId - ID of the admin performing the action (for audit).
   * @param ip - IP address of the admin's request (for audit).
   * @param userAgent - User-agent header of the admin's request (for audit).
   * @returns The updated user as a `SafeAuthUser` (no credentials).
   * @throws `NotFoundException` when the user is not found in the admin's tenant.
   * @throws `ForbiddenException` when the user belongs to a different tenant.
   */
  async updateStatus(
    targetUserId: string,
    dto: UpdateStatusDto,
    adminTenantId: string,
    adminUserId: string,
    ip: string,
    userAgent: string,
  ): Promise<SafeAuthUser> {
    const user = await this.userRepository.findById(targetUserId, adminTenantId);

    if (user === null) {
      throw new NotFoundException(`User '${targetUserId}' not found`);
    }

    // Belt-and-suspenders: findById with tenantId already scopes the result,
    // but we re-check to guard against future repository relaxations.
    if (user.tenantId !== adminTenantId) {
      throw new ForbiddenException('Access denied');
    }

    const previousStatus = user.status;

    // Scoped write: WHERE includes tenantId so the DB-level constraint also enforces
    // tenant isolation — no unscoped update can occur even under concurrent refactors.
    const updated = await this.prisma.user.update({
      where: { id: targetUserId, tenantId: adminTenantId },
      data: { status: dto.status },
    });

    // Write audit log — non-blocking: a write failure must not abort the status update.
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: adminTenantId,
          actorUserId: adminUserId,
          actorPlatformUserId: null,
          event: 'user.status.changed',
          payload: {
            targetUserId,
            from: previousStatus,
            to: dto.status,
          } satisfies Prisma.InputJsonValue,
          ip,
          userAgent,
        },
      });
    } catch (err: unknown) {
      this.logger.error({
        msg: 'AuditLog write failed for user.status.changed',
        targetUserId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // If the new status is blocked, forcibly close any open WebSocket connections
    // for this user so they cannot continue to receive push notifications.
    // This is non-blocking and fire-and-forget — a disconnect failure must not
    // abort the status update.
    this.notificationsGateway.maybeDisconnectBlockedUser(targetUserId, dto.status);

    const safe: SafeAuthUser = {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      status: updated.status,
      tenantId: updated.tenantId,
      emailVerified: updated.emailVerified,
      mfaEnabled: updated.mfaEnabled,
      lastLoginAt: updated.lastLoginAt,
      createdAt: updated.createdAt,
    };

    return safe;
  }

  /**
   * Returns all users belonging to `tenantId`, ordered by creation date.
   *
   * Results are scoped by tenantId in the WHERE clause — cross-tenant enumeration
   * is impossible even if the caller supplies a forged tenant ID (the JWT claim
   * is the authoritative source for tenantId passed here from the controller).
   *
   * @param tenantId - Tenant to scope the query to.
   * @returns Array of safe user records (no credential fields).
   */
  async listByTenant(tenantId: string): Promise<TenantUserRecord[]> {
    const rows = await this.prisma.user.findMany({
      where: { tenantId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        emailVerified: true,
        mfaEnabled: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return rows;
  }
}
