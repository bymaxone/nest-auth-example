/**
 * @file platform.service.spec.ts
 * @description Unit tests for `PlatformService`.
 *
 * Verifies:
 * - `listTenants` calls `prisma.tenant.findMany` with `{ orderBy: { createdAt: 'asc' }, take: 500 }`.
 * - `listUsers` calls `prisma.user.findMany` scoped to the given `tenantId` with the
 *   safe select block (no credential fields).
 * - `updateUserStatus`:
 *   - Throws `NotFoundException` when the target user does not exist (transaction returns null).
 *   - Returns the updated `PlatformSafeUser` on success.
 *   - Creates an `AuditLog` row after the transaction commits, with correct fields.
 *   - Swallows `AuditLog` write failures and logs an error instead of propagating.
 *
 *
 * @layer test
 * @see apps/api/src/platform/platform.service.ts
 */

import { Logger, NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@prisma/client';
import type { Tenant, User } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import { BYMAX_AUTH_REDIS_CLIENT, MfaService } from '@bymax-one/nest-auth';
import { USER_CONNECTION_PORT } from '../realtime/user-connection.port.js';

import { PlatformService } from './platform.service.js';
import type { PlatformSafeUser } from './platform.service.js';
import type { UpdateUserStatusDto } from './dto/update-user-status.dto.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a minimal valid `Tenant` row. */
function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: 'tenant-1',
    name: 'Acme Corp',
    slug: 'acme',
    domain: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as unknown as Tenant;
}

/** Builds a minimal valid `PlatformSafeUser` (no credentials). */
function makeSafeUser(overrides: Partial<PlatformSafeUser> = {}): PlatformSafeUser {
  return {
    id: 'user-1',
    email: 'user@example.com',
    name: 'Test User',
    role: 'MEMBER',
    status: UserStatus.ACTIVE,
    tenantId: 'tenant-1',
    emailVerified: true,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('PlatformService', () => {
  let service: PlatformService;
  let resetMfa: jest.Mock<() => Promise<void>>;
  let disconnectUser: jest.Mock<() => void>;
  let redisDel: jest.Mock<() => Promise<number>>;

  // Prisma mock stubs
  let tenantFindMany: jest.Mock<() => Promise<Tenant[]>>;
  let userFindMany: jest.Mock<(query?: Record<string, unknown>) => Promise<PlatformSafeUser[]>>;
  let userFindUnique: jest.Mock<() => Promise<Partial<User> | null>>;
  let userUpdate: jest.Mock<() => Promise<PlatformSafeUser>>;
  let auditLogCreate: jest.Mock<() => Promise<object>>;
  let transaction: jest.Mock<
    (cb: (tx: object) => Promise<unknown>, opts?: object) => Promise<unknown>
  >;

  beforeEach(async () => {
    tenantFindMany = jest.fn<() => Promise<Tenant[]>>();
    userFindMany = jest.fn<(query?: Record<string, unknown>) => Promise<PlatformSafeUser[]>>();
    userFindUnique = jest.fn<() => Promise<Partial<User> | null>>();
    userUpdate = jest.fn<() => Promise<PlatformSafeUser>>();
    auditLogCreate = jest.fn<() => Promise<object>>();

    // $transaction mock: calls the callback with a mock tx client and returns
    // its result, mirroring the real Prisma interactive transaction behaviour.
    transaction = jest
      .fn<(cb: (tx: object) => Promise<unknown>, opts?: object) => Promise<unknown>>()
      .mockImplementation(async (cb) => {
        const txClient = {
          user: {
            findUnique: userFindUnique,
            update: userUpdate,
          },
        };
        return cb(txClient);
      });

    resetMfa = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    disconnectUser = jest.fn<() => void>();
    redisDel = jest.fn<() => Promise<number>>().mockResolvedValue(1);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformService,
        {
          provide: PrismaService,
          useValue: {
            tenant: { findMany: tenantFindMany },
            user: { findMany: userFindMany, findUnique: userFindUnique },
            auditLog: { create: auditLogCreate },
            $transaction: transaction,
          },
        },
        // The library's MfaService backs the administrative reset flow.
        { provide: MfaService, useValue: { resetMfa } },
        // The gateway closes live sockets once the reset revokes the session.
        { provide: USER_CONNECTION_PORT, useValue: { disconnectUser } },
        // The library-namespaced Redis client backs the UserStatusGuard cache
        // invalidation performed after a status change.
        { provide: BYMAX_AUTH_REDIS_CLIENT, useValue: { del: redisDel } },
        // The status-cache key is namespaced from REDIS_NAMESPACE.
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'nest-auth-example' },
        },
      ],
    }).compile();

    service = moduleRef.get(PlatformService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── listTenants ─────────────────────────────────────────────────────────────

  describe('listTenants', () => {
    it('calls prisma.tenant.findMany with orderBy createdAt asc and take 500', async () => {
      /*
       * Scenario: listTenants must pass the exact query shape so tenants are
       * returned oldest-first and the result set is capped at 500 rows.
       * Protects: query contract — orderBy and take must not drift from spec.
       */
      const tenants = [makeTenant(), makeTenant({ id: 'tenant-2', slug: 'beta' })];
      tenantFindMany.mockResolvedValue(tenants);

      const result = await service.listTenants();

      expect(result).toBe(tenants);
      expect(tenantFindMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'asc' },
        take: 500,
      });
    });

    it('returns an empty array when no tenants exist', async () => {
      /*
       * Scenario: a fresh installation with no tenants yet — listTenants must
       * return an empty array without throwing.
       * Protects: empty result set handling.
       */
      tenantFindMany.mockResolvedValue([]);

      const result = await service.listTenants();

      expect(result).toEqual([]);
    });
  });

  // ─── listUsers ────────────────────────────────────────────────────────────────

  describe('listUsers', () => {
    it('calls prisma.user.findMany scoped to the given tenantId', async () => {
      /*
       * Scenario: listUsers must scope the query to the given tenantId so only
       * users belonging to that tenant are returned — no cross-tenant leakage.
       * Protects: tenantId scoping in the WHERE clause.
       */
      const users = [makeSafeUser()];
      userFindMany.mockResolvedValue(users);

      const result = await service.listUsers('tenant-1');

      expect(result).toBe(users);
      expect(userFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'tenant-1' } }),
      );
    });

    it('passes a select block that excludes credential fields', async () => {
      /*
       * Scenario: the SELECT must never include passwordHash, mfaSecret, or
       * mfaRecoveryCodes — credential safety is enforced via an explicit select.
       * Protects: credential fields are excluded by omission in SAFE_USER_SELECT.
       */
      userFindMany.mockResolvedValue([]);

      await service.listUsers('tenant-1');

      const callArg = userFindMany.mock.calls[0]?.[0];
      expect(callArg).toBeDefined();
      const select = callArg?.['select'] as Record<string, boolean> | undefined;
      expect(select).toBeDefined();
      // Credential fields must be absent.
      expect(select?.['passwordHash']).toBeUndefined();
      expect(select?.['mfaSecret']).toBeUndefined();
      expect(select?.['mfaRecoveryCodes']).toBeUndefined();
      // Safe fields must be present.
      expect(select?.['id']).toBe(true);
      expect(select?.['email']).toBe(true);
      expect(select?.['status']).toBe(true);
    });

    it('returns an empty array when the tenant has no users', async () => {
      /*
       * Scenario: a tenant with no registered users — listUsers must return an
       * empty array consistent with findMany semantics.
       * Protects: empty result set handling for listUsers.
       */
      userFindMany.mockResolvedValue([]);

      const result = await service.listUsers('empty-tenant');

      expect(result).toEqual([]);
    });
  });

  // ─── updateUserStatus ─────────────────────────────────────────────────────────

  describe('updateUserStatus', () => {
    const dto: UpdateUserStatusDto = { status: UserStatus.SUSPENDED };
    const actorId = 'platform-admin-1';
    const ip = '10.0.0.1';
    const userAgent = 'Mozilla/5.0';

    it('throws NotFoundException when the target user does not exist', async () => {
      /*
       * Scenario: the transaction callback calls findUnique and gets null back,
       * meaning the user does not exist. NotFoundException must be thrown and
       * propagated out of $transaction.
       * Protects: 404 guard — non-existent users must never silently no-op.
       */
      userFindUnique.mockResolvedValue(null);

      await expect(
        service.updateUserStatus('missing-user', dto, actorId, ip, userAgent),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the updated PlatformSafeUser on success', async () => {
      /*
       * Scenario: the user exists; after the update the safe user row is returned.
       * The audit log write succeeds silently.
       * Protects: happy-path return value of updateUserStatus.
       */
      const existing = { id: 'user-1', status: UserStatus.ACTIVE };
      const updated = makeSafeUser({ status: UserStatus.SUSPENDED });

      userFindUnique.mockResolvedValue(existing);
      userUpdate.mockResolvedValue(updated);
      auditLogCreate.mockResolvedValue({});

      const result = await service.updateUserStatus('user-1', dto, actorId, ip, userAgent);

      expect(result).toBe(updated);
    });

    it('calls prisma.user.update with the new status', async () => {
      /*
       * Scenario: the user.update call inside the transaction must receive the
       * target userId and the dto.status as data.
       * Protects: updateUserStatus writes the correct status to the correct row.
       */
      const existing = { id: 'user-1', status: UserStatus.ACTIVE };
      const updated = makeSafeUser({ status: UserStatus.SUSPENDED });

      userFindUnique.mockResolvedValue(existing);
      userUpdate.mockResolvedValue(updated);
      auditLogCreate.mockResolvedValue({});

      await service.updateUserStatus('user-1', dto, actorId, ip, userAgent);

      expect(userUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { status: UserStatus.SUSPENDED },
        }),
      );
    });

    it('creates an audit log entry with the correct fields after the transaction', async () => {
      /*
       * Scenario: after the transaction commits, an AuditLog row must be written
       * recording the actor, target, previous status, new status, IP, and
       * user-agent. tenantId must be null for platform-level events.
       * Protects: audit trail completeness for platform user status changes.
       */
      const existing = { id: 'user-1', status: UserStatus.ACTIVE };
      const updated = makeSafeUser({ status: UserStatus.SUSPENDED });

      userFindUnique.mockResolvedValue(existing);
      userUpdate.mockResolvedValue(updated);
      auditLogCreate.mockResolvedValue({});

      await service.updateUserStatus('user-1', dto, actorId, ip, userAgent);

      expect(auditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: null,
          actorUserId: null,
          actorPlatformUserId: actorId,
          event: 'platform.user.status_changed',
          payload: {
            targetUserId: 'user-1',
            previousStatus: UserStatus.ACTIVE,
            newStatus: UserStatus.SUSPENDED,
          },
          ip,
          userAgent,
        }),
      });
    });

    it('swallows audit log write failures and does not re-throw', async () => {
      /*
       * Scenario: the AuditLog create throws (e.g. DB timeout). The method must
       * log the error but NOT propagate it — the status update has already
       * committed successfully and must not be rolled back by an audit failure.
       * Protects: non-blocking audit — audit write failure must not abort the mutation.
       */
      const existing = { id: 'user-1', status: UserStatus.ACTIVE };
      const updated = makeSafeUser({ status: UserStatus.SUSPENDED });

      userFindUnique.mockResolvedValue(existing);
      userUpdate.mockResolvedValue(updated);
      auditLogCreate.mockRejectedValue(new Error('DB timeout'));

      // The method must resolve (not reject) even when auditLog.create throws.
      await expect(service.updateUserStatus('user-1', dto, actorId, ip, userAgent)).resolves.toBe(
        updated,
      );
    });

    it('still writes the audit row when cache invalidation fails after the commit', async () => {
      /*
       * Scenario: the status update has already committed when the Redis DEL
       * rejects. Letting that escape would answer 500 — telling the operator
       * the change failed when it did not — and would skip the audit row for a
       * change that actually happened. The stale cache entry expires on its own
       * TTL, so degrading here costs only a short enforcement delay.
       * Protects: the try/catch around the invalidation, and the fact that the
       * audit write still runs afterwards.
       */
      const existing = makeSafeUser({ status: UserStatus.ACTIVE });
      userFindUnique.mockResolvedValue(existing);
      userUpdate.mockResolvedValue(makeSafeUser({ status: UserStatus.BANNED }));
      auditLogCreate.mockResolvedValue({});
      redisDel.mockRejectedValue(new Error('redis down'));
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const dto: UpdateUserStatusDto = { status: UserStatus.BANNED };
      await expect(
        service.updateUserStatus('user-1', dto, 'admin-1', '127.0.0.1', 'jest'),
      ).resolves.toBeDefined();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'UserStatusGuard cache invalidation failed after status change',
        }),
      );
      expect(auditLogCreate).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('stringifies a non-Error cache-invalidation rejection', async () => {
      /*
       * Scenario: an ioredis client can reject with a bare string. `err.message`
       * is undefined on that path, so the log line must fall back to String(err)
       * rather than recording `undefined` as the cause.
       * Protects: the false arm of the `err instanceof Error` ternary.
       */
      userFindUnique.mockResolvedValue(makeSafeUser({ status: UserStatus.ACTIVE }));
      userUpdate.mockResolvedValue(makeSafeUser({ status: UserStatus.BANNED }));
      auditLogCreate.mockResolvedValue({});
      redisDel.mockRejectedValue('connection reset');
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const dto: UpdateUserStatusDto = { status: UserStatus.BANNED };
      await service.updateUserStatus('user-1', dto, 'admin-1', '127.0.0.1', 'jest');

      expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ error: 'connection reset' }));
      errorSpy.mockRestore();
    });

    it('runs the transaction with SERIALIZABLE isolation level', async () => {
      /*
       * Scenario: SERIALIZABLE isolation is required to prevent two concurrent
       * callers from both reading the same previousStatus and producing a
       * misleading audit trail. The $transaction call must pass the isolation level.
       * Protects: SERIALIZABLE isolation level is preserved in the transaction call.
       */
      const existing = { id: 'user-1', status: UserStatus.ACTIVE };
      const updated = makeSafeUser({ status: UserStatus.SUSPENDED });

      userFindUnique.mockResolvedValue(existing);
      userUpdate.mockResolvedValue(updated);
      auditLogCreate.mockResolvedValue({});

      await service.updateUserStatus('user-1', dto, actorId, ip, userAgent);

      // The second argument to $transaction must include the isolation level.
      const txOptions = transaction.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
      expect(txOptions).toBeDefined();
      expect(txOptions?.['isolationLevel']).toBe('Serializable');
    });

    it('uses String(err) when the audit log throws a non-Error value (non-Error throw path)', async () => {
      // Covers the `String(err)` branch of `err instanceof Error ? err.message : String(err)`.
      // Ensures the catch block handles non-Error rejections without rethrowing.
      const existing = { id: 'user-1', status: UserStatus.ACTIVE };
      const updated = makeSafeUser({ status: UserStatus.SUSPENDED });

      userFindUnique.mockResolvedValue(existing);
      userUpdate.mockResolvedValue(updated);
      auditLogCreate.mockRejectedValue('audit failure as plain string');

      await expect(service.updateUserStatus('user-1', dto, actorId, ip, userAgent)).resolves.toBe(
        updated,
      );
    });

    it('listUsers orders results by createdAt ascending', async () => {
      /*
       * Scenario: the platform admin UI displays the user list in
       * creation order so the oldest accounts appear first
       * (signup chronology). A drift that dropped the orderBy
       * clause would let Prisma return rows in indeterminate
       * order — visibly broken on every page load.
       */
      userFindMany.mockResolvedValue([]);

      await service.listUsers('tenant-acme');

      const calls = userFindMany.mock.calls as unknown as Array<
        [{ orderBy: { createdAt: string } }]
      >;
      expect(calls[0]?.[0].orderBy).toEqual({ createdAt: 'asc' });
    });

    it('updateUserStatus pre-read select restricts the projection to {id, status}', async () => {
      /*
       * Scenario: the pre-update read inside the SERIALIZABLE
       * transaction only needs the previous status (for the
       * audit row) and the id (to confirm the row exists).
       * Widening the select would leak credential columns
       * through the platform admin path; a regression that
       * dropped `status` from the select would make the audit
       * row record `undefined` as the previous state.
       */
      const existing = { id: 'user-1', status: UserStatus.ACTIVE };
      const updated = makeSafeUser({ status: UserStatus.SUSPENDED });
      userFindUnique.mockResolvedValue(existing);
      userUpdate.mockResolvedValue(updated);

      await service.updateUserStatus('user-1', dto, actorId, ip, userAgent);

      const calls = userFindUnique.mock.calls as unknown as Array<
        [{ where: { id: string }; select: { id: boolean; status: boolean } }]
      >;
      expect(calls[0]?.[0].select).toEqual({ id: true, status: true });
    });

    it('surfaces "User \'<id>\' not found" verbatim when the target row is missing', async () => {
      /*
       * Scenario: the platform admin attempts to suspend a user
       * id that does not exist. The 404 message MUST name the
       * specific user id so the audit trail and UI surface
       * exactly which action missed — the same pattern as the
       * tenant-scoped status update.
       */
      userFindUnique.mockResolvedValue(null);

      await expect(
        service.updateUserStatus('ghost-id', dto, actorId, ip, userAgent),
      ).rejects.toThrow("User 'ghost-id' not found");
    });

    it('logs the documented audit-write failure payload when prisma.auditLog.create rejects', async () => {
      /*
       * Scenario: the status mutation succeeds but the audit row
       * insert briefly fails (transient DB issue). The service
       * MUST NOT abort the response — losing the audit row is
       * preferable to refusing a successful platform admin
       * action — but the failure must surface in operator logs
       * with the canonical event message, the target user id,
       * and the underlying error so support can investigate
       * the audit-trail gap.
       */
      const existing = { id: 'user-1', status: UserStatus.ACTIVE };
      const updated = makeSafeUser({ status: UserStatus.SUSPENDED });
      userFindUnique.mockResolvedValue(existing);
      userUpdate.mockResolvedValue(updated);
      auditLogCreate.mockRejectedValueOnce(new Error('Postgres down'));
      const errorSpy = jest
        .spyOn((service as unknown as { logger: { error: (m: unknown) => void } }).logger, 'error')
        .mockImplementation(() => undefined);

      await service.updateUserStatus('user-1', dto, actorId, ip, userAgent);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const arg = errorSpy.mock.calls[0]?.[0] as {
        msg?: string;
        targetUserId?: string;
        error?: string;
      };
      expect(arg.msg).toBe('AuditLog write failed for platform.user.status_changed');
      expect(arg.targetUserId).toBe('user-1');
      expect(arg.error).toBe('Postgres down');
    });
  });

  describe('resetUserMfa', () => {
    /** Arguments the controller forwards, in order. */
    const ARGS = ['user-1', 'platform-admin-1', '203.0.113.9', 'Mozilla/5.0'] as const;

    it('throws NotFoundException when the target user does not exist', async () => {
      /*
       * Scenario: a SUPER_ADMIN posts a reset for an id that is not in the
       * database. The service must refuse before calling MfaService, because
       * `resetMfa` on an unknown id would otherwise revoke sessions and bump
       * the token epoch for nobody while reporting success.
       * Protects: the pre-read guard and its short-circuit.
       */
      userFindUnique.mockResolvedValue(null);

      await expect(service.resetUserMfa(...ARGS)).rejects.toBeInstanceOf(NotFoundException);
      expect(resetMfa).not.toHaveBeenCalled();
      expect(auditLogCreate).not.toHaveBeenCalled();
    });

    it('surfaces "User \'<id>\' not found" verbatim when the target row is missing', async () => {
      /*
       * Scenario: the message is what a platform operator reads in the API
       * response, so it is pinned verbatim including the quoted id.
       * Protects: StringLiteral mutants on the thrown message template.
       */
      userFindUnique.mockResolvedValue(null);

      await expect(service.resetUserMfa(...ARGS)).rejects.toThrow("User 'user-1' not found");
    });

    it("delegates the reset to the library's MfaService scoped to the target's own tenant", async () => {
      /*
       * Scenario: platform admins act across tenants, so the tenant passed to
       * `resetMfa` must come from the TARGET user's row, never from the actor.
       * Passing the wrong tenant would either miss the session keys or touch
       * another tenant's — the cross-tenant bug this app exists to demonstrate
       * the absence of.
       * Protects: the pre-read select of `tenantId` and its use in the call.
       */
      userFindUnique
        .mockResolvedValueOnce({ id: 'user-1', tenantId: 'tenant-42' })
        .mockResolvedValueOnce(makeSafeUser({ tenantId: 'tenant-42' }));
      auditLogCreate.mockResolvedValue({});

      await service.resetUserMfa(...ARGS);

      expect(resetMfa).toHaveBeenCalledWith('user-1', 'dashboard', 'tenant-42');
    });

    it('returns the re-read user so the caller sees mfaEnabled false', async () => {
      /*
       * Scenario: the response must reflect state AFTER the library wrote, not
       * the pre-read projection — returning the pre-read row would report
       * mfaEnabled: true immediately after a successful reset.
       * Protects: the post-reset re-read and its return.
       */
      const updated = makeSafeUser({ mfaEnabled: false });
      userFindUnique
        .mockResolvedValueOnce({ id: 'user-1', tenantId: 'tenant-1' })
        .mockResolvedValueOnce(updated);
      auditLogCreate.mockResolvedValue({});

      await expect(service.resetUserMfa(...ARGS)).resolves.toEqual(updated);
    });

    it('throws NotFoundException when the row vanishes between the reset and the re-read', async () => {
      /*
       * Scenario: a concurrent hard delete removes the user after the reset
       * committed. Returning a fabricated user here would report success for
       * an account that no longer exists.
       * Protects: the second not-found guard — the one a naive implementation
       * omits because "the row existed a moment ago".
       */
      userFindUnique
        .mockResolvedValueOnce({ id: 'user-1', tenantId: 'tenant-1' })
        .mockResolvedValueOnce(null);
      auditLogCreate.mockResolvedValue({});

      await expect(service.resetUserMfa(...ARGS)).rejects.toBeInstanceOf(NotFoundException);
      expect(resetMfa).toHaveBeenCalled();
    });

    it('closes the target user live notification sockets after the reset', async () => {
      /*
       * Scenario: the gateway authenticates a socket once, at connect time, so
       * a connection opened before the reset keeps streaming afterwards even
       * though `resetMfa` revoked the session and bumped the token epoch. An
       * administrative reset answers a suspected compromise, so leaving the
       * suspect's socket open would undo the revocation it just performed.
       * Protects: the `disconnectUser` call — nothing else in the HTTP path
       * would ever close that socket.
       */
      userFindUnique
        .mockResolvedValueOnce({ id: 'user-1', tenantId: 'tenant-1' })
        .mockResolvedValueOnce(makeSafeUser());
      auditLogCreate.mockResolvedValue({});

      await service.resetUserMfa(...ARGS);

      expect(disconnectUser).toHaveBeenCalledWith('user-1');
    });

    it('does not close sockets when the target user does not exist', async () => {
      /*
       * Scenario: the pre-read finds no row, so no reset happens and no
       * revocation occurred. Disconnecting here would drop a live session
       * belonging to whoever currently holds that id — a denial of service
       * driven by a typo'd id.
       * Protects: the ordering — disconnect happens after a successful reset,
       * never on the not-found path.
       */
      userFindUnique.mockResolvedValue(null);

      await expect(service.resetUserMfa(...ARGS)).rejects.toBeInstanceOf(NotFoundException);
      expect(disconnectUser).not.toHaveBeenCalled();
    });

    it('writes a platform-scoped audit row with the documented fields', async () => {
      /*
       * Scenario: an administrative MFA reset is a privileged action, so it
       * must leave an audit trail naming the actor, the target, and the
       * target's tenant. `tenantId` is null by design — platform events are
       * not scoped to a tenant even when their target is.
       * Protects: every field of the audit payload, including the null
       * tenantId invariant and the verbatim event name.
       */
      userFindUnique
        .mockResolvedValueOnce({ id: 'user-1', tenantId: 'tenant-7' })
        .mockResolvedValueOnce(makeSafeUser());
      auditLogCreate.mockResolvedValue({});

      await service.resetUserMfa(...ARGS);

      expect(auditLogCreate).toHaveBeenCalledWith({
        data: {
          tenantId: null,
          actorUserId: null,
          actorPlatformUserId: 'platform-admin-1',
          event: 'platform.user.mfa_reset',
          payload: { targetUserId: 'user-1', targetTenantId: 'tenant-7' },
          ip: '203.0.113.9',
          userAgent: 'Mozilla/5.0',
        },
      });
    });

    it('swallows an audit write failure and still returns the updated user', async () => {
      /*
       * Scenario: the reset already committed in the library when the audit
       * insert fails. Propagating that error would tell the operator the reset
       * failed while it actually succeeded, inviting a pointless retry.
       * Protects: the try/catch around auditLog.create and the Error branch of
       * its message extraction.
       */
      const updated = makeSafeUser();
      userFindUnique
        .mockResolvedValueOnce({ id: 'user-1', tenantId: 'tenant-1' })
        .mockResolvedValueOnce(updated);
      auditLogCreate.mockRejectedValue(new Error('DB timeout'));
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.resetUserMfa(...ARGS)).resolves.toEqual(updated);
      expect(errorSpy).toHaveBeenCalledWith({
        msg: 'AuditLog write failed for platform.user.mfa_reset',
        targetUserId: 'user-1',
        error: 'DB timeout',
      });
      errorSpy.mockRestore();
    });

    it('stringifies a non-Error audit rejection instead of logging undefined', async () => {
      /*
       * Scenario: a driver rejects with a bare string. `err.message` would be
       * undefined on that path, so the log line must fall back to String(err).
       * Protects: the false arm of the `err instanceof Error` ternary.
       */
      userFindUnique
        .mockResolvedValueOnce({ id: 'user-1', tenantId: 'tenant-1' })
        .mockResolvedValueOnce(makeSafeUser());
      auditLogCreate.mockRejectedValue('plain string rejection');
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await service.resetUserMfa(...ARGS);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'plain string rejection' }),
      );
      errorSpy.mockRestore();
    });

    it('reads only {id, tenantId} on the pre-read projection', async () => {
      /*
       * Scenario: the pre-read exists to answer "does this user exist and in
       * which tenant". Widening it would pull credential columns into memory
       * for no reason.
       * Protects: the select block of the first findUnique call.
       */
      userFindUnique
        .mockResolvedValueOnce({ id: 'user-1', tenantId: 'tenant-1' })
        .mockResolvedValueOnce(makeSafeUser());
      auditLogCreate.mockResolvedValue({});

      await service.resetUserMfa(...ARGS);

      expect(userFindUnique).toHaveBeenNthCalledWith(1, {
        where: { id: 'user-1' },
        select: { id: true, tenantId: true },
      });
    });
  });
});
