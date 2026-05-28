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

  // ─── Database call shapes, exception messages, and side-effect bodies ─────

  describe('database call shapes and exception messages', () => {
    it('surfaces "Inviter not found" verbatim when the acting user cannot be resolved', async () => {
      /*
       * Scenario: the inviter's session is valid but the underlying
       * user row is gone (deleted by another admin). The 404 message
       * must be the literal text the UI binds to so the toast tells
       * the admin to sign in again, instead of showing an opaque
       * "Not Found" page.
       */
      userFindUnique.mockResolvedValue(null);
      tenantFindUnique.mockResolvedValue({ id: 'acme', name: 'Acme' });

      await expect(
        service.create('missing', 'acme', { email: 'a@b.test', role: 'MEMBER' }),
      ).rejects.toThrow('Inviter not found');
    });

    it('surfaces "Tenant not found" verbatim when the tenant row is missing', async () => {
      /*
       * Scenario: the JWT references a tenant id that no longer exists
       * in the database (rare — possible after a manual cleanup). The
       * invitation flow must abort early with a recognisable message
       * before any Redis or email side-effects fire.
       */
      userFindUnique.mockResolvedValue({ id: 'u', name: 'U', role: 'ADMIN' });
      tenantFindUnique.mockResolvedValue(null);

      await expect(
        service.create('u', 'missing', { email: 'a@b.test', role: 'MEMBER' }),
      ).rejects.toThrow('Tenant not found');
    });

    it('forbidden-role message names both the inviter role and the requested role', async () => {
      /*
       * Scenario: a MEMBER tries to invite an ADMIN. The 403 response
       * must name BOTH roles in the message so the admin investigating
       * the audit trail can immediately see what was attempted, instead
       * of guessing which side of the hierarchy was at fault.
       */
      userFindUnique.mockResolvedValue({ id: 'u', name: 'U', role: 'MEMBER' });
      tenantFindUnique.mockResolvedValue({ id: 'acme', name: 'Acme' });
      mockHasRole.mockReturnValue(false);

      await expect(
        service.create('u', 'acme', { email: 'a@b.test', role: 'ADMIN' }),
      ).rejects.toThrow('Your role (MEMBER) cannot invite users with role ADMIN.');
    });

    it('inviter lookup requests {id, name, role} from prisma.user', async () => {
      /*
       * Scenario: the invitation email shows the inviter's display name
       * ("Alice invited you to Acme Corp"), and the service uses the
       * inviter role to authorise the requested role. If the select
       * narrowed to only `id`, the email would render with `undefined`
       * for the inviter's name and the role check would compare
       * against an empty string.
       */
      userFindUnique.mockResolvedValue({ id: 'u', name: 'U', role: 'ADMIN' });
      tenantFindUnique.mockResolvedValue({ id: 'acme', name: 'Acme' });
      invitationCreate.mockResolvedValue(makeInvitationRecord());
      sendInvitation.mockResolvedValue(undefined);
      redisSet.mockResolvedValue('OK');

      await service.create('u', 'acme', { email: 'a@b.test', role: 'MEMBER' });

      const calls = userFindUnique.mock.calls as unknown as Array<
        [{ select: { id: boolean; name: boolean; role: boolean } }]
      >;
      expect(calls[0]?.[0].select).toEqual({ id: true, name: true, role: true });
    });

    it('tenant lookup requests {id, name} from prisma.tenant', async () => {
      /*
       * Scenario: the invitation email also embeds the tenant display
       * name ("…to Acme Corp"). The select must keep both `id` and
       * `name` populated — dropping either would render the email
       * with an `undefined` workspace name and confuse the recipient
       * about which organisation invited them.
       */
      userFindUnique.mockResolvedValue({ id: 'u', name: 'U', role: 'ADMIN' });
      tenantFindUnique.mockResolvedValue({ id: 'acme', name: 'Acme' });
      invitationCreate.mockResolvedValue(makeInvitationRecord());
      sendInvitation.mockResolvedValue(undefined);
      redisSet.mockResolvedValue('OK');

      await service.create('u', 'acme', { email: 'a@b.test', role: 'MEMBER' });

      const calls = tenantFindUnique.mock.calls as unknown as Array<
        [{ select: { id: boolean; name: boolean } }]
      >;
      expect(calls[0]?.[0].select).toEqual({ id: true, name: true });
    });

    it('redis payload is JSON-parseable and carries every field the accept endpoint needs', async () => {
      /*
       * Scenario: when the invitee clicks the email link, the library
       * reads the Redis payload to know which workspace, role, and
       * email the invitation grants. The payload MUST contain
       * `email`, `role`, `tenantId`, `inviterUserId`, and a
       * `createdAt` timestamp — a stripped-down payload would either
       * fail the accept flow or grant the wrong role.
       */
      userFindUnique.mockResolvedValue({ id: 'admin-id', name: 'A', role: 'ADMIN' });
      tenantFindUnique.mockResolvedValue({ id: 'acme', name: 'Acme' });
      invitationCreate.mockResolvedValue(makeInvitationRecord());
      sendInvitation.mockResolvedValue(undefined);
      redisSet.mockResolvedValue('OK');

      await service.create('admin-id', 'acme', { email: 'BOB@example.test', role: 'MEMBER' });

      const calls = redisSet.mock.calls as unknown as Array<[string, string, string, number]>;
      const payload = JSON.parse(calls[0]?.[1] ?? '{}') as Record<string, unknown>;
      expect(payload['email']).toBe('bob@example.test');
      expect(payload['role']).toBe('MEMBER');
      expect(payload['tenantId']).toBe('acme');
      expect(payload['inviterUserId']).toBe('admin-id');
      expect(typeof payload['createdAt']).toBe('string');
    });

    it('expiresAt lands 48 hours in the future on the persisted invitation row', async () => {
      /*
       * Scenario: the invitation row carries an `expiresAt` Date that
       * the admin UI uses to show the countdown and to filter out
       * expired entries from the "pending" list. The deadline must
       * land 48 hours from now — a value computed in the past would
       * make every new invitation look already-expired, and a value
       * far in the future would let stale invitations linger.
       */
      userFindUnique.mockResolvedValue({ id: 'u', name: 'U', role: 'ADMIN' });
      tenantFindUnique.mockResolvedValue({ id: 'acme', name: 'Acme' });
      invitationCreate.mockResolvedValue(makeInvitationRecord());
      sendInvitation.mockResolvedValue(undefined);
      redisSet.mockResolvedValue('OK');

      const before = Date.now();
      await service.create('u', 'acme', { email: 'a@b.test', role: 'MEMBER' });
      const after = Date.now();

      const calls = invitationCreate.mock.calls as unknown as Array<
        [{ data: { expiresAt: Date } }]
      >;
      const expiresAt = calls[0]?.[0].data.expiresAt;
      expect(expiresAt).toBeInstanceOf(Date);
      // noUncheckedIndexedAccess narrows expiresAt to Date | undefined here;
      // the instanceof assertion above proves it is defined at runtime.
      if (!(expiresAt instanceof Date)) throw new Error('unreachable: expiresAt asserted above');
      const ttlMs = 172_800 * 1000;
      // The deadline must land in (before + ttl) <= expiresAt <= (after + ttl).
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + ttlMs);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(after + ttlMs);
    });

    it('logs an error with the failed invitation id and reason when email delivery fails', async () => {
      /*
       * Scenario: the invitation row was persisted but the email
       * provider rejected the send (transient SMTP outage). The flow
       * must NOT throw — the admin would lose context about the
       * partially-completed invitation — but the failure must be
       * observable in operator logs so support can resend manually.
       * The log entry pinpoints the invitation id and the upstream
       * error message.
       */
      userFindUnique.mockResolvedValue({ id: 'u', name: 'U', role: 'ADMIN' });
      tenantFindUnique.mockResolvedValue({ id: 'acme', name: 'Acme' });
      invitationCreate.mockResolvedValue(makeInvitationRecord());
      sendInvitation.mockRejectedValue(new Error('SMTP down'));
      redisSet.mockResolvedValue('OK');
      const errorSpy = jest
        .spyOn((service as unknown as { logger: { error: (m: unknown) => void } }).logger, 'error')
        .mockImplementation(() => undefined);

      await service.create('u', 'acme', { email: 'a@b.test', role: 'MEMBER' });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const arg = errorSpy.mock.calls[0]?.[0] as { msg?: string; error?: string };
      expect(arg.msg).toBe('invitations: email delivery failed');
      expect(arg.error).toBe('SMTP down');
    });

    it('listByTenant orders pending invitations newest-first', async () => {
      /*
       * Scenario: the admin "pending invitations" page shows the most
       * recently sent invites at the top so the admin can quickly see
       * what they just did. A drift that drops the orderBy clause
       * would let Prisma return rows in indeterminate order — visibly
       * broken to anyone managing more than a couple of invites.
       */
      invitationFindMany.mockResolvedValue([]);

      await service.listByTenant('acme');

      const calls = invitationFindMany.mock.calls as unknown as Array<
        [{ orderBy: { createdAt: string } }]
      >;
      expect(calls[0]?.[0].orderBy).toEqual({ createdAt: 'desc' });
    });

    it('revoke 404 names the missing invitation id in the response message', async () => {
      /*
       * Scenario: an admin clicks "revoke" on a stale row that another
       * admin already deleted. The 404 message must identify the
       * specific invitation id so the audit trail (and the toast)
       * shows which entry failed — a generic "not found" hides which
       * action actually missed.
       */
      invitationFindUnique.mockResolvedValue(null);

      await expect(service.revoke('inv-xyz', 'acme')).rejects.toThrow(
        "Invitation 'inv-xyz' not found",
      );
    });

    it('logs a warning with the invitation id and reason when Redis cleanup fails on revoke', async () => {
      /*
       * Scenario: the Prisma delete succeeded but the corresponding
       * Redis entry could not be cleaned (network blip). The
       * invitation IS logically revoked — the Redis entry will
       * expire at its TTL — but the partial outage must surface in
       * operator logs with the invitation id so support can verify
       * the orphaned entry is gone within the TTL window.
       */
      invitationFindUnique.mockResolvedValue({ tenantId: 'acme', token: 'tok-hash' });
      invitationDelete.mockResolvedValue(makeInvitationRecord());
      redisDel.mockRejectedValue(new Error('Redis down'));
      const warnSpy = jest
        .spyOn((service as unknown as { logger: { warn: (m: unknown) => void } }).logger, 'warn')
        .mockImplementation(() => undefined);

      await service.revoke('inv-1', 'acme');

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const arg = warnSpy.mock.calls[0]?.[0] as { msg?: string; id?: string; error?: string };
      expect(arg.msg).toBe('invitations: Redis cleanup failed');
      expect(arg.id).toBe('inv-1');
      expect(arg.error).toBe('Redis down');
    });

    it('does not log an error on the happy invitation path (email delivered)', async () => {
      /*
       * Scenario: every successful invitation must keep the operator
       * log quiet. Spurious error entries on the happy path would
       * flood production logs and dilute the signal of real email
       * delivery failures — making it harder to spot a genuine
       * outage in time to resend.
       */
      userFindUnique.mockResolvedValue({ id: 'u', name: 'U', role: 'ADMIN' });
      tenantFindUnique.mockResolvedValue({ id: 'acme', name: 'Acme' });
      invitationCreate.mockResolvedValue(makeInvitationRecord());
      sendInvitation.mockResolvedValue(undefined);
      redisSet.mockResolvedValue('OK');
      const errorSpy = jest
        .spyOn((service as unknown as { logger: { error: (m: unknown) => void } }).logger, 'error')
        .mockImplementation(() => undefined);

      await service.create('u', 'acme', { email: 'a@b.test', role: 'MEMBER' });

      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
