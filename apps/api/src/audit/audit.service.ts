/**
 * @file audit.service.ts
 * @description Read-only service for the audit log viewer at
 * `/dashboard/audit`. Mirrors the data the lib's `IAuthHooks` writes
 * via `AppAuthHooks` — login attempts, MFA changes, password resets,
 * session evictions, and so on — so administrators can inspect what
 * the auth lifecycle actually did.
 *
 * Tenant-scoped: every query filters by the caller's `tenantId`, never
 * exposes platform-level rows (those have `tenantId === null` and live
 * in the separate `PlatformAuditLog` ledger if/when one exists). The
 * `AuditLog` table is APPEND-ONLY by convention — no update/delete
 * method exists here, and the controller never exposes a mutation
 * surface.
 *
 * @layer audit
 * @see apps/api/src/auth/app-auth.hooks.ts
 * @see docs/guidelines/observability-guidelines.md
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Maximum number of audit rows returned per call. Pinned at 100 to keep
 * the response small (audit payloads vary in size) and to render
 * smoothly without virtualisation. A future "Load more" pager could
 * extend this without changing the contract.
 */
const AUDIT_PAGE_SIZE = 100;

/**
 * One row exposed by `GET /api/audit`. Mirrors the relevant subset of
 * the `AuditLog` Prisma model — internal columns (`actorPlatformUserId`)
 * are deliberately omitted so the JSON contract stays tight.
 *
 * @public
 */
export interface AuditEntry {
  /** Row identifier (cuid). */
  readonly id: string;
  /** Event slug, e.g. `user.login.succeeded`. */
  readonly event: string;
  /**
   * Actor user id (when the event was triggered by an authenticated
   * tenant user). `null` for system-initiated events such as the
   * brute-force lockout firing automatically.
   */
  readonly actorUserId: string | null;
  /** Structured event payload — opaque JSON written by the hook. */
  readonly payload: unknown;
  /** Source IP recorded by the hook. */
  readonly ip: string | null;
  /** User-Agent recorded by the hook. */
  readonly userAgent: string | null;
  /** ISO 8601 creation timestamp. */
  readonly createdAt: string;
}

/**
 * Read-only access to the tenant-scoped audit log.
 *
 * @public
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the most recent audit entries for the caller's tenant.
   *
   * Sorted newest-first via `createdAt DESC`. Capped at
   * `AUDIT_PAGE_SIZE` to keep the response small and the UI snappy.
   *
   * @param tenantId - Authenticated user's tenant ID (from the JWT).
   * @returns Up to {@link AUDIT_PAGE_SIZE} audit entries, newest first.
   */
  async listRecent(tenantId: string): Promise<AuditEntry[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: AUDIT_PAGE_SIZE,
      select: {
        id: true,
        event: true,
        actorUserId: true,
        payload: true,
        ip: true,
        userAgent: true,
        createdAt: true,
      },
    });

    return rows.map((row) => ({
      id: row.id,
      event: row.event,
      actorUserId: row.actorUserId,
      payload: row.payload,
      ip: row.ip,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
