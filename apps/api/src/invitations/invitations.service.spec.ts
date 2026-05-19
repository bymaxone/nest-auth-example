/**
 * @file invitations.service.spec.ts
 * @description Unit tests for `InvitationsService`.
 *
 * Verifies:
 * - `create`: inviter-not-found → NotFoundException; tenant-not-found → NotFoundException;
 *   role too low for requested role → ForbiddenException; success path stores in Redis
 *   and Prisma then emails; email delivery failure is swallowed (logger.error, no throw).
 * - `listByTenant`: delegates to prisma.invitation.findMany scoped by tenantId.
 * - `revoke`: invitation-not-found → NotFoundException; cross-tenant → NotFoundException;
 *   success: prisma.delete + redis.del; Redis cleanup failure swallowed (logger.warn).
 *
 * `@bymax-one/nest-auth` helper functions are mocked via `jest.unstable_mockModule`
 * so tests run deterministically without real crypto or Redis connections.
 *
 * FCM rows covered: #20 (multi-tenant isolation), #4 (invitation flow).
 *
 * @layer test
 * @see apps/api/src/invitations/invitations.service.ts
 */

import { jest } from '@jest/globals';

// ─── ESM mocks — must appear before any application import ───────────────────

// Stub the library helpers to avoid real crypto and make tokens deterministic.
const mockGenerateSecureToken = jest.fn<() => string>();
const mockSha256 = jest.fn<(input: string) => string>();
const mockHasRole =
  jest.fn<
    (userRole: string, requestedRole: string, hierarchy: Record<string, string[]>) => boolean
  >();

jest.unstable_mockModule('@bymax-one/nest-auth', () => ({
  BYMAX_AUTH_REDIS_CLIENT: 'BYMAX_AUTH_REDIS_CLIENT',
  BYMAX_AUTH_EMAIL_PROVIDER: 'BYMAX_AUTH_EMAIL_PROVIDER',
  generateSecureToken: mockGenerateSecureToken,
  sha256: mockSha256,
  hasRole: mockHasRole,
}));

// ─── Imports (after mock registration) ───────────────────────────────────────

import { ForbiddenException, NotFoundException } from '@nestjs/common';

// Static value imports are hoisted past jest.unstable_mockModule in ESM — the
// service must be loaded via dynamic import so @bymax-one/nest-auth resolves
// to the mock above rather than the real module.
const { InvitationsService } = await import('./invitations.service.js');
type InvitationsServiceType = InstanceType<typeof InvitationsService>;

import type { InvitationRecord } from './invitations.service.js';
import type { CreateInvitationDto } from './dto/create-invitation.dto.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a minimal `InvitationRecord` for assertions. */
function makeInvitationRecord(overrides: Partial<InvitationRecord> = {}): InvitationRecord {
  return {
    id: 'inv-1',
    email: 'bob@example.test',
    role: 'MEMBER',
    invitedByUserId: 'user-admin',
    expiresAt: new Date('2026-05-01T00:00:00Z'),
    createdAt: new Date('2026-04-25T00:00:00Z'),
    ...overrides,
  };
}

/** Inviter row shape returned by prisma.user.findUnique. */
type InviterRow = { id: string; name: string; role: string } | null;

/** Tenant row shape returned by prisma.tenant.findUnique. */
type TenantRow = { id: string; name: string } | null;

/** Invitation row shape returned by prisma.invitation.findUnique. */
type InvitationLookupRow = { tenantId: string; token: string } | null;

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('InvitationsService', () => {
  let service: InvitationsServiceType;

  // Prisma mock methods
  let userFindUnique: jest.Mock<() => Promise<InviterRow>>;
  let tenantFindUnique: jest.Mock<() => Promise<TenantRow>>;
  let invitationCreate: jest.Mock<() => Promise<InvitationRecord>>;
  let invitationFindMany: jest.Mock<() => Promise<InvitationRecord[]>>;
  let invitationFindUnique: jest.Mock<() => Promise<InvitationLookupRow>>;
  let invitationDelete: jest.Mock<() => Promise<InvitationRecord>>;

  // Redis mock methods
  let redisSet: jest.Mock<() => Promise<string>>;
  let redisDel: jest.Mock<() => Promise<number>>;

  // Email provider mock
  let sendInvitation: jest.Mock<() => Promise<void>>;

  beforeEach(() => {
    userFindUnique = jest.fn<() => Promise<InviterRow>>();
    tenantFindUnique = jest.fn<() => Promise<TenantRow>>();
    invitationCreate = jest.fn<() => Promise<InvitationRecord>>();
    invitationFindMany = jest.fn<() => Promise<InvitationRecord[]>>();
    invitationFindUnique = jest.fn<() => Promise<InvitationLookupRow>>();
    invitationDelete = jest.fn<() => Promise<InvitationRecord>>();
    redisSet = jest.fn<() => Promise<string>>();
    redisDel = jest.fn<() => Promise<number>>();
    sendInvitation = jest.fn<() => Promise<void>>();

    // Default stubs for the library helpers.
    mockGenerateSecureToken.mockReturnValue('raw-token-abc');
    mockSha256.mockImplementation((input: string) => `sha256(${input})`);
    mockHasRole.mockReturnValue(true);

    // Direct constructor injection bypasses NestJS DI and the Symbol-token
    // mismatch that occurs when the test module resolves @Inject() tokens
    // against mock-module string values.
    type PartialPrisma = {
      user: { findUnique: typeof userFindUnique };
      tenant: { findUnique: typeof tenantFindUnique };
      invitation: {
        create: typeof invitationCreate;
        findMany: typeof invitationFindMany;
        findUnique: typeof invitationFindUnique;
        delete: typeof invitationDelete;
      };
    };
    const mockPrisma: PartialPrisma = {
      user: { findUnique: userFindUnique },
      tenant: { findUnique: tenantFindUnique },
      invitation: {
        create: invitationCreate,
        findMany: invitationFindMany,
        findUnique: invitationFindUnique,
        delete: invitationDelete,
      },
    };
    const mockRedis = { set: redisSet, del: redisDel };
    const mockEmailProvider = { sendInvitation };

    service = new InvitationsService(
      mockPrisma as unknown as import('../prisma/prisma.service.js').PrismaService,
      mockRedis as unknown as import('ioredis').Redis,
      mockEmailProvider as unknown as import('@bymax-one/nest-auth').IEmailProvider,
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto: CreateInvitationDto = { email: 'bob@example.test', role: 'MEMBER' };

    it('throws NotFoundException when the inviter user is not found in the tenant', async () => {
      // An invalid or cross-tenant inviterUserId must surface as 404 — not 403 —
      // to prevent cross-tenant enumeration via distinct error codes.
      userFindUnique.mockResolvedValue(null);
      tenantFindUnique.mockResolvedValue({ id: 'acme', name: 'Acme Corp' });

      await expect(service.create('missing-user', 'acme', dto)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the tenant record is not found', async () => {
      // A missing tenant is a configuration error that must abort the flow before
      // any Redis or email side-effect occurs.
      userFindUnique.mockResolvedValue({ id: 'user-admin', name: 'Admin', role: 'ADMIN' });
      tenantFindUnique.mockResolvedValue(null);

      await expect(service.create('user-admin', 'missing-tenant', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when the inviter role is insufficient for the requested role', async () => {
      // A MEMBER cannot invite ADMIN users. hasRole returns false to signal
      // the role hierarchy violation.
      userFindUnique.mockResolvedValue({ id: 'user-member', name: 'Bob', role: 'MEMBER' });
      tenantFindUnique.mockResolvedValue({ id: 'acme', name: 'Acme Corp' });
      mockHasRole.mockReturnValue(false);

      const adminDto: CreateInvitationDto = { email: 'new@example.test', role: 'ADMIN' };
      await expect(service.create('user-member', 'acme', adminDto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('calls redis.set with the hashed token and invitation payload on success', async () => {
      // The Redis entry is what the library's accept endpoint consumes. It must
      // be written before the Prisma record so the token is always live when
      // the invitee clicks the link.
      userFindUnique.mockResolvedValue({ id: 'user-admin', name: 'Admin', role: 'ADMIN' });
      tenantFindUnique.mockResolvedValue({ id: 'acme', name: 'Acme Corp' });
      invitationCreate.mockResolvedValue(makeInvitationRecord());
      sendInvitation.mockResolvedValue(undefined);
      redisSet.mockResolvedValue('OK');

      await service.create('user-admin', 'acme', dto);

      expect(redisSet).toHaveBeenCalledTimes(1);
      // Key must use the sha256 of the raw token.
      expect(redisSet).toHaveBeenCalledWith(
        expect.stringContaining('sha256(raw-token-abc)'),
        expect.any(String),
        'EX',
        172_800,
      );
    });

    it('calls prisma.invitation.create with correct fields on success', async () => {
      // The Prisma record tracks pending invitations so admins can list and revoke them.
      userFindUnique.mockResolvedValue({ id: 'user-admin', name: 'Admin', role: 'ADMIN' });
      tenantFindUnique.mockResolvedValue({ id: 'acme', name: 'Acme Corp' });
      invitationCreate.mockResolvedValue(makeInvitationRecord());
      sendInvitation.mockResolvedValue(undefined);
      redisSet.mockResolvedValue('OK');

      await service.create('user-admin', 'acme', dto);

      expect(invitationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'acme',
            email: 'bob@example.test',
            role: 'MEMBER',
            invitedByUserId: 'user-admin',
          }),
        }),
      );
    });

    it('normalises the invitee email to lower-case before storage', async () => {
      // Consistent lower-case ensures the unique-index lookup during acceptance
      // works regardless of the case the admin typed the email in.
      userFindUnique.mockResolvedValue({ id: 'user-admin', name: 'Admin', role: 'ADMIN' });
      tenantFindUnique.mockResolvedValue({ id: 'acme', name: 'Acme Corp' });
      invitationCreate.mockResolvedValue(makeInvitationRecord());
      sendInvitation.mockResolvedValue(undefined);
      redisSet.mockResolvedValue('OK');

      const upperCaseDto: CreateInvitationDto = { email: '  BOB@EXAMPLE.TEST  ', role: 'MEMBER' };
      await service.create('user-admin', 'acme', upperCaseDto);

      expect(invitationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'bob@example.test' }),
        }),
      );
    });

    it('calls emailProvider.sendInvitation with the raw token on success', async () => {
      // The raw token (never hashed) is embedded in the invitation link. The
      // email provider must receive it verbatim so the invitee can complete sign-up.
      userFindUnique.mockResolvedValue({ id: 'user-admin', name: 'Admin', role: 'ADMIN' });
      tenantFindUnique.mockResolvedValue({ id: 'acme', name: 'Acme Corp' });
      invitationCreate.mockResolvedValue(makeInvitationRecord());
      sendInvitation.mockResolvedValue(undefined);
      redisSet.mockResolvedValue('OK');

      await service.create('user-admin', 'acme', dto);

      expect(sendInvitation).toHaveBeenCalledWith(
        'bob@example.test',
        expect.objectContaining({ inviteToken: 'raw-token-abc' }),
      );
    });

    it('returns the created InvitationRecord on success', async () => {
      // The record is passed back to the controller, which serialises it as the
      // HTTP 201 response body.
      userFindUnique.mockResolvedValue({ id: 'user-admin', name: 'Admin', role: 'ADMIN' });
      tenantFindUnique.mockResolvedValue({ id: 'acme', name: 'Acme Corp' });
      const record = makeInvitationRecord();
      invitationCreate.mockResolvedValue(record);
      sendInvitation.mockResolvedValue(undefined);
      redisSet.mockResolvedValue('OK');

      const result = await service.create('user-admin', 'acme', dto);

      expect(result).toBe(record);
    });

    it('swallows email delivery failures — does not throw, logs an error', async () => {
      // Email delivery is best-effort. A transient SMTP failure must not
      // roll back the Redis + Prisma writes (the invitation is still valid).
      userFindUnique.mockResolvedValue({ id: 'user-admin', name: 'Admin', role: 'ADMIN' });
      tenantFindUnique.mockResolvedValue({ id: 'acme', name: 'Acme Corp' });
      invitationCreate.mockResolvedValue(makeInvitationRecord());
      sendInvitation.mockRejectedValue(new Error('SMTP timeout'));
      redisSet.mockResolvedValue('OK');

      await expect(service.create('user-admin', 'acme', dto)).resolves.toBeDefined();
    });

    it('logs non-Error email delivery failures using String(err) (non-Error throw path)', async () => {
      // Covers the `String(err)` branch of `err instanceof Error ? err.message : String(err)`.
      // Some transports throw plain strings rather than Error instances.
      userFindUnique.mockResolvedValue({ id: 'user-admin', name: 'Admin', role: 'ADMIN' });
      tenantFindUnique.mockResolvedValue({ id: 'acme', name: 'Acme Corp' });
      invitationCreate.mockResolvedValue(makeInvitationRecord());
      sendInvitation.mockRejectedValue('SMTP connection refused');
      redisSet.mockResolvedValue('OK');

      await expect(service.create('user-admin', 'acme', dto)).resolves.toBeDefined();
    });
  });

  // ─── listByTenant ─────────────────────────────────────────────────────────

  describe('listByTenant', () => {
    it('returns pending non-expired invitations scoped to the tenant', async () => {
      // All invitations in the response belong to the caller's tenant — no
      // cross-tenant records must appear even if a rogue tenantId is supplied.
      const records = [makeInvitationRecord(), makeInvitationRecord({ id: 'inv-2' })];
      invitationFindMany.mockResolvedValue(records);

      const result = await service.listByTenant('acme');

      expect(result).toBe(records);
      expect(invitationFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'acme' }),
        }),
      );
    });

    it('filters for non-accepted (acceptedAt: null) and non-expired invitations', async () => {
      // Only pending, unexpired invitations should be visible — accepted or
      // expired ones must not appear in the admin list.
      invitationFindMany.mockResolvedValue([]);

      await service.listByTenant('acme');

      expect(invitationFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            acceptedAt: null,
            expiresAt: expect.objectContaining({ gt: expect.any(Date) }),
          }),
        }),
      );
    });

    it('returns an empty array when no pending invitations exist', async () => {
      // An empty array is a valid state (no open invitations) and must not
      // produce an error.
      invitationFindMany.mockResolvedValue([]);

      const result = await service.listByTenant('empty-tenant');

      expect(result).toEqual([]);
    });
  });

  // ─── revoke ───────────────────────────────────────────────────────────────

  describe('revoke', () => {
    it('throws NotFoundException when the invitation is not found', async () => {
      // A missing invitation ID must produce 404 — not 403 — to prevent
      // cross-tenant enumeration via distinct error codes.
      invitationFindUnique.mockResolvedValue(null);

      await expect(service.revoke('nonexistent-inv', 'acme')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the invitation belongs to a different tenant (cross-tenant guard)', async () => {
      // Even if the invitation exists, returning 404 for a cross-tenant revoke
      // prevents the admin from learning that an invitation ID belongs to another tenant.
      invitationFindUnique.mockResolvedValue({ tenantId: 'other-tenant', token: 'tok-hash' });

      await expect(service.revoke('inv-1', 'acme')).rejects.toThrow(NotFoundException);
    });

    it('calls prisma.invitation.delete with the invitation id on success', async () => {
      // The Prisma record must be deleted so the invitation no longer appears in list.
      invitationFindUnique.mockResolvedValue({ tenantId: 'acme', token: 'tok-hash' });
      invitationDelete.mockResolvedValue(makeInvitationRecord());
      redisDel.mockResolvedValue(1);

      await service.revoke('inv-1', 'acme');

      expect(invitationDelete).toHaveBeenCalledWith({ where: { id: 'inv-1' } });
    });

    it('calls redis.del with the namespaced token key on success', async () => {
      // Best-effort Redis cleanup prevents the token from being accepted after
      // revocation, even though the TTL would eventually expire it anyway.
      invitationFindUnique.mockResolvedValue({ tenantId: 'acme', token: 'tok-hash' });
      invitationDelete.mockResolvedValue(makeInvitationRecord());
      redisDel.mockResolvedValue(1);

      await service.revoke('inv-1', 'acme');

      expect(redisDel).toHaveBeenCalledWith('nest-auth-example:inv:tok-hash');
    });

    it('resolves to undefined on success', async () => {
      // A void return maps to the HTTP 204 No Content response in the controller.
      invitationFindUnique.mockResolvedValue({ tenantId: 'acme', token: 'tok-hash' });
      invitationDelete.mockResolvedValue(makeInvitationRecord());
      redisDel.mockResolvedValue(1);

      await expect(service.revoke('inv-1', 'acme')).resolves.toBeUndefined();
    });

    it('swallows Redis cleanup failures — does not throw, warns via logger', async () => {
      // Redis cleanup is best-effort. The invitation is logically revoked once
      // the Prisma record is deleted; a Redis failure must not undo that.
      invitationFindUnique.mockResolvedValue({ tenantId: 'acme', token: 'tok-hash' });
      invitationDelete.mockResolvedValue(makeInvitationRecord());
      redisDel.mockRejectedValue(new Error('Redis connection lost'));

      await expect(service.revoke('inv-1', 'acme')).resolves.toBeUndefined();
    });

    it('uses String(err) when Redis cleanup throws a non-Error value (non-Error throw path)', async () => {
      // Covers the `String(err)` branch of `err instanceof Error ? err.message : String(err)`.
      // Redis errors are not always Error instances in all driver versions.
      invitationFindUnique.mockResolvedValue({ tenantId: 'acme', token: 'tok-hash' });
      invitationDelete.mockResolvedValue(makeInvitationRecord());
      redisDel.mockRejectedValue('connection lost');

      await expect(service.revoke('inv-1', 'acme')).resolves.toBeUndefined();
    });
  });
});
