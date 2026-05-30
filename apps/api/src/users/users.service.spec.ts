/**
 * @file users.service.spec.ts
 * @description Unit tests for `UsersService`.
 *
 * Verifies:
 * - `updateStatus`: user-not-found → NotFoundException; cross-tenant user →
 *   ForbiddenException; success: prisma.user.update called, audit log created,
 *   maybeDisconnectBlockedUser called; AuditLog write failure swallowed.
 * - `listByTenant`: delegates to prisma.user.findMany scoped by tenantId.
 *
 * FCM rows covered: #20 (multi-tenant isolation), #21 (audit logging),
 * #24 (blocked-user disconnect).
 *
 * @layer test
 * @see apps/api/src/users/users.service.ts
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';
import { BYMAX_AUTH_REDIS_CLIENT } from '@bymax-one/nest-auth';
import type { SafeAuthUser } from '@bymax-one/nest-auth';

import { PrismaUserRepository } from '../auth/prisma-user.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsGateway } from '../notifications/notifications.gateway.js';
import { UsersService } from './users.service.js';
import type { TenantUserRecord } from './users.service.js';
import type { UpdateStatusDto } from './dto/update-status.dto.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a minimal `SafeAuthUser` for use as findById / update return value. */
function makeSafeUser(overrides: Partial<SafeAuthUser> = {}): SafeAuthUser {
  return {
    id: 'user-1',
    email: 'alice@example.test',
    name: 'Alice Test',
    role: 'MEMBER',
    status: 'ACTIVE',
    tenantId: 'acme',
    emailVerified: true,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Prisma user row shape returned by prisma.user.update. */
type PrismaUserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  tenantId: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

/** Builds a minimal Prisma user row for update mock return values. */
function makePrismaRow(overrides: Partial<PrismaUserRow> = {}): PrismaUserRow {
  return {
    id: 'user-1',
    email: 'alice@example.test',
    name: 'Alice Test',
    role: 'MEMBER',
    status: 'ACTIVE',
    tenantId: 'acme',
    emailVerified: true,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Builds a minimal `TenantUserRecord` for list assertions. */
function makeTenantUserRecord(overrides: Partial<TenantUserRecord> = {}): TenantUserRecord {
  return {
    id: 'user-1',
    email: 'alice@example.test',
    name: 'Alice Test',
    role: 'MEMBER',
    status: 'ACTIVE',
    emailVerified: true,
    mfaEnabled: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('UsersService', () => {
  let service: UsersService;

  // Repository mock
  let findById: jest.Mock<() => Promise<SafeAuthUser | null>>;

  // Prisma mock methods
  let userUpdate: jest.Mock<() => Promise<PrismaUserRow>>;
  let auditLogCreate: jest.Mock<() => Promise<unknown>>;
  let userFindMany: jest.Mock<() => Promise<TenantUserRecord[]>>;

  // Gateway mock
  let maybeDisconnectBlockedUser: jest.Mock<(userId: string, status: string) => void>;

  // Redis mock — UsersService uses BYMAX_AUTH_REDIS_CLIENT to invalidate the
  // user-status cache after a status update.
  let redisDel: jest.Mock<() => Promise<number>>;

  beforeEach(async () => {
    findById = jest.fn<() => Promise<SafeAuthUser | null>>();
    userUpdate = jest.fn<() => Promise<PrismaUserRow>>();
    auditLogCreate = jest.fn<() => Promise<unknown>>();
    userFindMany = jest.fn<() => Promise<TenantUserRecord[]>>();
    maybeDisconnectBlockedUser = jest.fn<(userId: string, status: string) => void>();
    redisDel = jest.fn<() => Promise<number>>().mockResolvedValue(1);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaUserRepository,
          useValue: { findById },
        },
        {
          provide: PrismaService,
          useValue: {
            user: { update: userUpdate, findMany: userFindMany },
            auditLog: { create: auditLogCreate },
          },
        },
        {
          provide: NotificationsGateway,
          useValue: { maybeDisconnectBlockedUser },
        },
        {
          provide: BYMAX_AUTH_REDIS_CLIENT,
          useValue: { del: redisDel },
        },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── updateStatus ─────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    const dto: UpdateStatusDto = { status: UserStatus.ACTIVE };
    const params = {
      targetUserId: 'user-1',
      adminTenantId: 'acme',
      adminUserId: 'admin-1',
      ip: '127.0.0.1',
      userAgent: 'Jest/1.0',
    };

    it('throws NotFoundException when the target user is not found in the admin tenant', async () => {
      // A missing user or cross-tenant user ID surfaces as 404 — not 403 — to
      // prevent the admin from learning whether a user ID exists in another tenant.
      findById.mockResolvedValue(null);

      await expect(
        service.updateStatus(
          params.targetUserId,
          dto,
          params.adminTenantId,
          params.adminUserId,
          params.ip,
          params.userAgent,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the user belongs to a different tenant', async () => {
      // The belt-and-suspenders check: even if findById returns a user,
      // a tenantId mismatch must be rejected as forbidden.
      findById.mockResolvedValue(makeSafeUser({ tenantId: 'other-tenant' }));

      await expect(
        service.updateStatus(
          params.targetUserId,
          dto,
          params.adminTenantId,
          params.adminUserId,
          params.ip,
          params.userAgent,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('calls prisma.user.update with the new status scoped to tenantId', async () => {
      // The update WHERE must include tenantId so the DB-level constraint also
      // enforces tenant isolation — no unscoped update can occur under concurrent refactors.
      findById.mockResolvedValue(makeSafeUser({ tenantId: 'acme' }));
      userUpdate.mockResolvedValue(makePrismaRow({ status: 'SUSPENDED' }));
      auditLogCreate.mockResolvedValue(undefined);

      const suspendDto: UpdateStatusDto = { status: UserStatus.SUSPENDED };
      await service.updateStatus(
        params.targetUserId,
        suspendDto,
        params.adminTenantId,
        params.adminUserId,
        params.ip,
        params.userAgent,
      );

      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'user-1', tenantId: 'acme' },
        data: { status: UserStatus.SUSPENDED },
      });
    });

    it('creates an audit log entry with the previous and new status', async () => {
      // Every status change must be audited so tenant admins have a full history
      // of who changed what and when (FCM #21).
      findById.mockResolvedValue(makeSafeUser({ tenantId: 'acme', status: 'ACTIVE' }));
      userUpdate.mockResolvedValue(makePrismaRow({ status: 'SUSPENDED' }));
      auditLogCreate.mockResolvedValue(undefined);

      const suspendDto: UpdateStatusDto = { status: UserStatus.SUSPENDED };
      await service.updateStatus(
        params.targetUserId,
        suspendDto,
        params.adminTenantId,
        params.adminUserId,
        params.ip,
        params.userAgent,
      );

      expect(auditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'acme',
            actorUserId: 'admin-1',
            event: 'user.status.changed',
            payload: expect.objectContaining({
              targetUserId: 'user-1',
              from: 'ACTIVE',
              to: UserStatus.SUSPENDED,
            }),
          }),
        }),
      );
    });

    it('calls maybeDisconnectBlockedUser with the target userId and new status', async () => {
      // When a user is blocked, all open WebSocket connections must be severed
      // immediately so they cannot continue receiving push notifications.
      findById.mockResolvedValue(makeSafeUser({ tenantId: 'acme' }));
      userUpdate.mockResolvedValue(makePrismaRow({ status: 'SUSPENDED' }));
      auditLogCreate.mockResolvedValue(undefined);

      const suspendDto: UpdateStatusDto = { status: UserStatus.SUSPENDED };
      await service.updateStatus(
        params.targetUserId,
        suspendDto,
        params.adminTenantId,
        params.adminUserId,
        params.ip,
        params.userAgent,
      );

      expect(maybeDisconnectBlockedUser).toHaveBeenCalledWith('user-1', UserStatus.SUSPENDED);
    });

    it('returns a SafeAuthUser with the updated fields on success', async () => {
      // The response body is the updated user record (no credentials) so the
      // frontend can update its local state without a second fetch.
      findById.mockResolvedValue(makeSafeUser({ tenantId: 'acme' }));
      userUpdate.mockResolvedValue(makePrismaRow({ status: 'SUSPENDED' }));
      auditLogCreate.mockResolvedValue(undefined);

      const suspendDto: UpdateStatusDto = { status: UserStatus.SUSPENDED };
      const result = await service.updateStatus(
        params.targetUserId,
        suspendDto,
        params.adminTenantId,
        params.adminUserId,
        params.ip,
        params.userAgent,
      );

      expect(result.id).toBe('user-1');
      expect(result.status).toBe('SUSPENDED');
      // Sensitive fields must not be present on SafeAuthUser.
      expect('passwordHash' in result).toBe(false);
    });

    it('invalidates the user-status cache by the exact `nest-auth-example:us:<userId>` Redis key', async () => {
      /*
       * Scenario: after a status change, the lib's
       * UserStatusGuard reads from Redis to enforce the new
       * status on the very next request. The cache key MUST
       * include the redis namespace prefix and the target user
       * id — an empty key would clear an unrelated key (or
       * fail), leaving the suspended user able to call
       * protected routes for up to 60 seconds.
       */
      findById.mockResolvedValue(makeSafeUser({ tenantId: 'acme' }));
      userUpdate.mockResolvedValue(makePrismaRow({ status: 'SUSPENDED' }));
      auditLogCreate.mockResolvedValue(undefined);

      await service.updateStatus(
        'user-cache-key',
        { status: UserStatus.SUSPENDED },
        'acme',
        'admin-1',
        '127.0.0.1',
        'agent',
      );

      expect(redisDel).toHaveBeenCalledTimes(1);
      const calls = redisDel.mock.calls as unknown as Array<[string]>;
      expect(calls[0]?.[0]).toBe('nest-auth-example:us:user-cache-key');
    });

    it('swallows AuditLog write failures — does not throw, status update still returns', async () => {
      // A transient DB failure on the audit log must not roll back the status
      // update — the change is more important than the audit trail.
      findById.mockResolvedValue(makeSafeUser({ tenantId: 'acme' }));
      userUpdate.mockResolvedValue(makePrismaRow({ status: 'SUSPENDED' }));
      auditLogCreate.mockRejectedValue(new Error('audit DB failure'));

      const suspendDto: UpdateStatusDto = { status: UserStatus.SUSPENDED };
      await expect(
        service.updateStatus(
          params.targetUserId,
          suspendDto,
          params.adminTenantId,
          params.adminUserId,
          params.ip,
          params.userAgent,
        ),
      ).resolves.toBeDefined();
    });

    it('uses String(err) when the audit log throws a non-Error value (non-Error throw path)', async () => {
      // Covers the `String(err)` branch of `err instanceof Error ? err.message : String(err)`.
      // Some Prisma error types or network timeouts throw non-Error objects.
      findById.mockResolvedValue(makeSafeUser({ tenantId: 'acme' }));
      userUpdate.mockResolvedValue(makePrismaRow({ status: 'SUSPENDED' }));
      auditLogCreate.mockRejectedValue('audit failure as plain string');

      const suspendDto: UpdateStatusDto = { status: UserStatus.SUSPENDED };
      await expect(
        service.updateStatus(
          params.targetUserId,
          suspendDto,
          params.adminTenantId,
          params.adminUserId,
          params.ip,
          params.userAgent,
        ),
      ).resolves.toBeDefined();
    });
  });

  // ─── findById ─────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns a TenantUserRecord when the user exists in the tenant', async () => {
      /**
       * Scenario: a caller with a valid tenantId requests their own profile.
       * The service must return a safe, credential-free user record.
       * Rule: findById(id, tenantId) → TenantUserRecord when the user exists.
       */
      const safeUser = makeSafeUser({ id: 'user-3', tenantId: 'acme' });
      findById.mockResolvedValue(safeUser);

      const result = await service.findById('user-3', 'acme');

      expect(result.id).toBe('user-3');
      expect(result.email).toBe(safeUser.email);
      expect(result.name).toBe(safeUser.name);
      expect(result.role).toBe(safeUser.role);
      expect(result.status).toBe(safeUser.status);
      expect(result.emailVerified).toBe(safeUser.emailVerified);
      expect(result.mfaEnabled).toBe(safeUser.mfaEnabled);
      expect(result.createdAt).toBe(safeUser.createdAt);
    });

    it('throws NotFoundException when the user is not found in the tenant', async () => {
      /**
       * Scenario: the requested user does not exist in the caller's tenant (either
       * a wrong id or a cross-tenant probe). The service must return 404 rather
       * than leaking cross-tenant existence via a 403.
       * Rule: findById returns NotFoundException (not ForbiddenException) on miss,
       * and the 404 message names the requested id verbatim so the client can tell
       * which lookup failed.
       */
      findById.mockResolvedValue(null);

      await expect(service.findById('missing-user', 'acme')).rejects.toThrow(NotFoundException);
      await expect(service.findById('missing-user', 'acme')).rejects.toThrow(
        "User 'missing-user' not found",
      );
    });

    it('calls the repository with the correct id and tenantId', async () => {
      /**
       * Scenario: the repository must receive the exact id and tenantId passed
       * by the controller so cross-tenant queries are impossible.
       * Rule: PrismaUserRepository.findById is called with (id, tenantId).
       */
      findById.mockResolvedValue(makeSafeUser({ tenantId: 'beta' }));

      await service.findById('user-9', 'beta');

      expect(findById).toHaveBeenCalledWith('user-9', 'beta');
    });
  });

  // ─── listByTenant ─────────────────────────────────────────────────────────

  describe('listByTenant', () => {
    it('returns all users scoped to the tenant from prisma.user.findMany', async () => {
      // The WHERE clause must include tenantId so cross-tenant records can never
      // appear in the response (FCM #20).
      const rows = [makeTenantUserRecord(), makeTenantUserRecord({ id: 'user-2' })];
      userFindMany.mockResolvedValue(rows);

      const result = await service.listByTenant('acme');

      expect(result).toBe(rows);
      expect(userFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'acme' } }),
      );
    });

    it('returns an empty array when no users exist in the tenant', async () => {
      // An empty tenant is a valid state (e.g. just after tenant creation).
      userFindMany.mockResolvedValue([]);

      const result = await service.listByTenant('empty-tenant');

      expect(result).toEqual([]);
    });

    it('orders results by createdAt ascending', async () => {
      // Consistent ordering ensures the admin list is deterministic and pagination
      // works correctly when implemented in the future.
      userFindMany.mockResolvedValue([]);

      await service.listByTenant('acme');

      expect(userFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'asc' } }),
      );
    });
  });

  // ─── Exception messages and audit-log failure observability ──────────────

  describe('updateStatus error messages and audit observability', () => {
    it('surfaces "User \'<id>\' not found" with the requested id when no row matches', async () => {
      /*
       * Scenario: an admin attempts to change the status of a user
       * id that no longer exists (deleted in another tab, or a
       * stale dashboard). The 404 message MUST name the specific
       * user id so the audit log and the admin's UI toast can
       * differentiate which action missed.
       */
      findById.mockResolvedValue(null);

      await expect(
        service.updateStatus(
          'ghost-user-cuid',
          { status: UserStatus.SUSPENDED },
          'tenant-acme',
          'admin-1',
          '203.0.113.5',
          'admin-agent',
        ),
      ).rejects.toThrow("User 'ghost-user-cuid' not found");
    });

    it('surfaces the documented "Access denied" message when the target row belongs to another tenant', async () => {
      /*
       * Scenario: a defensive belt-and-suspenders check fires when
       * the row resolves but its tenantId no longer matches the
       * admin's (data drift, mid-flight tenant move). The 403
       * message MUST stay generic — "Access denied" — to avoid
       * leaking the fact that the user exists in another tenant.
       */
      findById.mockResolvedValue({
        ...makeSafeUser({ tenantId: 'tenant-globex' }),
      });

      await expect(
        service.updateStatus(
          'user-1',
          { status: UserStatus.SUSPENDED },
          'tenant-acme',
          'admin-1',
          '203.0.113.5',
          'admin-agent',
        ),
      ).rejects.toThrow('Access denied');
    });

    it('logs the AuditLog write failure with the documented message, target id, and error reason', async () => {
      /*
       * Scenario: the status update succeeded but the audit-log
       * insert failed (e.g. Postgres briefly unavailable). The
       * service MUST NOT abort — losing the audit row is
       * preferable to refusing a successful status change — but
       * the failure must surface in operator logs with the
       * canonical message, target user id, and root cause so
       * support can investigate the audit-trail gap.
       */
      findById.mockResolvedValue(makeSafeUser({ tenantId: 'tenant-acme' }));
      userUpdate.mockResolvedValue(makePrismaRow());
      redisDel.mockResolvedValue(1);
      auditLogCreate.mockRejectedValue(new Error('Postgres down'));
      const errorSpy = jest
        .spyOn((service as unknown as { logger: { error: (m: unknown) => void } }).logger, 'error')
        .mockImplementation(() => undefined);

      await service.updateStatus(
        'user-1',
        { status: UserStatus.SUSPENDED },
        'tenant-acme',
        'admin-1',
        '203.0.113.5',
        'admin-agent',
      );

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const arg = errorSpy.mock.calls[0]?.[0] as {
        msg?: string;
        targetUserId?: string;
        error?: string;
      };
      expect(arg.msg).toBe('AuditLog write failed for user.status.changed');
      expect(arg.targetUserId).toBe('user-1');
      expect(arg.error).toBe('Postgres down');
    });

    it('uses String(err) when the audit-log error is not an Error instance', async () => {
      /*
       * Scenario: some Postgres drivers reject with plain strings
       * instead of Error objects. The error-message extractor
       * (`err instanceof Error ? err.message : String(err)`) must
       * fall back to `String(err)` so the log entry still carries
       * a useful reason even when the rejection bypasses the
       * Error class.
       */
      findById.mockResolvedValue(makeSafeUser({ tenantId: 'tenant-acme' }));
      userUpdate.mockResolvedValue(makePrismaRow());
      redisDel.mockResolvedValue(1);
      auditLogCreate.mockRejectedValue('plain-string failure');
      const errorSpy = jest
        .spyOn((service as unknown as { logger: { error: (m: unknown) => void } }).logger, 'error')
        .mockImplementation(() => undefined);

      await service.updateStatus(
        'user-1',
        { status: UserStatus.SUSPENDED },
        'tenant-acme',
        'admin-1',
        '203.0.113.5',
        'admin-agent',
      );

      const arg = errorSpy.mock.calls[0]?.[0] as { error?: string };
      expect(arg.error).toBe('plain-string failure');
    });
  });
});
