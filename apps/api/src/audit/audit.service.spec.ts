/**
 * @file audit.service.spec.ts
 * @description Unit tests for `AuditService` — the read-only side of
 * the audit log surfacing rows the lib's `IAuthHooks` write through
 * `AppAuthHooks`.
 *
 * Verifies:
 * - Rows are scoped by `tenantId` (no cross-tenant leak).
 * - The query orders by `createdAt DESC` and caps at the page size.
 * - The mapper preserves the columns the UI consumes (id, event, actor,
 *   payload, ip, userAgent) and serialises the timestamp to ISO 8601.
 * - Empty tenant → empty array (no exception, no synthetic rows).
 *
 * @layer test
 * @see apps/api/src/audit/audit.service.ts
 */

import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from './audit.service.js';

/** Row shape returned by `prisma.auditLog.findMany` after `select`. */
interface AuditRow {
  id: string;
  event: string;
  actorUserId: string | null;
  payload: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

describe('AuditService', () => {
  let service: AuditService;
  let findMany: jest.Mock<() => Promise<AuditRow[]>>;

  beforeEach(async () => {
    findMany = jest.fn<() => Promise<AuditRow[]>>();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: PrismaService,
          useValue: { auditLog: { findMany } },
        },
      ],
    }).compile();
    service = moduleRef.get(AuditService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('listRecent', () => {
    it('returns an empty array when the tenant has no audit rows', async () => {
      /*
       * Scenario: a freshly-created tenant has never had a user sign in
       * or do anything that fires a hook. The endpoint must return `[]`
       * — not throw, not return synthetic data, not 500. Pins the
       * happy-path empty case so the UI can render its empty-state
       * panel without a special error branch.
       */
      findMany.mockResolvedValue([]);

      const result = await service.listRecent('tenant-acme');

      expect(result).toEqual([]);
    });

    it('scopes the query by tenantId, orders DESC, and caps at 100 rows', async () => {
      /*
       * Scenario: every read MUST filter by tenantId AND sort newest
       * first AND take only 100. Without all three, the endpoint
       * either leaks rows from another tenant (security), surfaces
       * ancient data in the wrong order (UX), or returns thousands of
       * rows that crash the table render (perf). Pinning the exact
       * call shape catches a refactor that drops any one of them.
       */
      findMany.mockResolvedValue([]);

      await service.listRecent('tenant-acme');

      expect(findMany).toHaveBeenCalledTimes(1);
      const calls = findMany.mock.calls as unknown as Array<
        [{ where: { tenantId: string }; orderBy: { createdAt: string }; take: number }]
      >;
      const args = calls[0]?.[0];
      expect(args?.where.tenantId).toBe('tenant-acme');
      expect(args?.orderBy.createdAt).toBe('desc');
      expect(args?.take).toBe(100);
    });

    it('maps each row to the public AuditEntry shape with an ISO timestamp', async () => {
      /*
       * Scenario: the Prisma row has a `Date` instance for `createdAt`,
       * but the JSON envelope must carry an ISO string. The mapper
       * also strips columns the UI doesn't consume (e.g. internal
       * actorPlatformUserId). Pinning the projection so a refactor
       * that returns the raw Prisma row would surface as a test
       * failure rather than as a structural leak to the client.
       */
      const date = new Date('2026-05-26T14:00:00.000Z');
      findMany.mockResolvedValue([
        {
          id: 'audit-1',
          event: 'user.login.succeeded',
          actorUserId: 'user-1',
          payload: { reason: 'password' },
          ip: '10.0.0.1',
          userAgent: 'Mozilla/5.0',
          createdAt: date,
        },
      ]);

      const result = await service.listRecent('tenant-acme');

      expect(result).toEqual([
        {
          id: 'audit-1',
          event: 'user.login.succeeded',
          actorUserId: 'user-1',
          payload: { reason: 'password' },
          ip: '10.0.0.1',
          userAgent: 'Mozilla/5.0',
          createdAt: '2026-05-26T14:00:00.000Z',
        },
      ]);
    });

    it('preserves null actor / ip / userAgent values verbatim', async () => {
      /*
       * Scenario: system-initiated events (e.g. brute-force auto-lock)
       * have a null actorUserId and may also have null ip / userAgent
       * when the hook fires outside a request context. The mapper
       * must NOT coerce nulls to empty strings — the UI distinguishes
       * "system" from a real "0.0.0.0" actor.
       */
      findMany.mockResolvedValue([
        {
          id: 'audit-2',
          event: 'system.lockout',
          actorUserId: null,
          payload: { reason: 'too_many_attempts' },
          ip: null,
          userAgent: null,
          createdAt: new Date('2026-05-26T14:01:00.000Z'),
        },
      ]);

      const [row] = await service.listRecent('tenant-acme');
      expect(row?.actorUserId).toBeNull();
      expect(row?.ip).toBeNull();
      expect(row?.userAgent).toBeNull();
    });
  });
});
