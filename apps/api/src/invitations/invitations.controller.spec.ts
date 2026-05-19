/**
 * @file invitations.controller.spec.ts
 * @description Unit tests for `InvitationsController`.
 *
 * Verifies that the controller is a thin delegation layer — each route method
 * forwards its arguments to the corresponding `InvitationsService` method and
 * returns the service's result unchanged.
 *
 * Guards (`JwtAuthGuard`, `UserStatusGuard`, `RolesGuard`) are not exercised
 * here; they are validated in e2e tests. The goal is to confirm the controller
 * does not silently transform data or swallow service errors.
 *
 * @layer test
 * @see apps/api/src/invitations/invitations.controller.ts
 */

import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { DashboardJwtPayload } from '@bymax-one/nest-auth';

import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import type { InvitationRecord } from './invitations.service.js';
import type { CreateInvitationDto } from './dto/create-invitation.dto.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a minimal `InvitationRecord` for test assertions. */
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

/** Builds a minimal `DashboardJwtPayload` stub for `@CurrentUser()` injection. */
function makeJwtPayload(overrides: Partial<DashboardJwtPayload> = {}): DashboardJwtPayload {
  return {
    sub: 'user-admin',
    jti: '00000000-0000-4000-8000-000000000001',
    type: 'dashboard',
    tenantId: 'acme',
    role: 'ADMIN',
    mfaEnabled: false,
    mfaVerified: false,
    iat: 0,
    exp: 9999999999,
    ...overrides,
  } as unknown as DashboardJwtPayload;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('InvitationsController', () => {
  let controller: InvitationsController;
  let listByTenant: jest.Mock<() => Promise<InvitationRecord[]>>;
  let create: jest.Mock<() => Promise<InvitationRecord>>;
  let revoke: jest.Mock<() => Promise<void>>;

  beforeEach(async () => {
    listByTenant = jest.fn<() => Promise<InvitationRecord[]>>();
    create = jest.fn<() => Promise<InvitationRecord>>();
    revoke = jest.fn<() => Promise<void>>();

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [InvitationsController],
      providers: [
        {
          provide: InvitationsService,
          useValue: { listByTenant, create, revoke },
        },
      ],
    }).compile();

    controller = moduleRef.get(InvitationsController);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── list ─────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('delegates to invitationsService.listByTenant with the user tenantId', async () => {
      // The controller must forward tenantId from the JWT-derived AuthUser to
      // ensure tenant isolation — never from request body or query params.
      const user = makeJwtPayload({ tenantId: 'acme' });
      const records = [makeInvitationRecord()];
      listByTenant.mockResolvedValue(records);

      const result = await controller.list(user);

      expect(result).toBe(records);
      expect(listByTenant).toHaveBeenCalledWith('acme');
    });

    it('returns an empty array when listByTenant resolves with []', async () => {
      // The tenant has no pending invitations — the controller must propagate
      // the empty array unchanged.
      const user = makeJwtPayload();
      listByTenant.mockResolvedValue([]);

      const result = await controller.list(user);

      expect(result).toEqual([]);
    });
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('delegates to invitationsService.create with userId, tenantId, and dto', async () => {
      // The controller must pass the inviter's userId and tenantId from the JWT
      // (not from the request body) to prevent privilege escalation.
      const user = makeJwtPayload({ sub: 'user-admin', tenantId: 'acme' });
      const dto: CreateInvitationDto = { email: 'bob@example.test', role: 'MEMBER' };
      const record = makeInvitationRecord();
      create.mockResolvedValue(record);

      const result = await controller.create(dto, user);

      expect(result).toBe(record);
      expect(create).toHaveBeenCalledWith('user-admin', 'acme', dto);
    });

    it('propagates service errors without modification', async () => {
      // Error transparency — the controller must not swallow or re-wrap
      // exceptions raised by the service layer.
      const user = makeJwtPayload();
      const dto: CreateInvitationDto = { email: 'bob@example.test', role: 'MEMBER' };
      create.mockRejectedValue(new Error('service error'));

      await expect(controller.create(dto, user)).rejects.toThrow('service error');
    });
  });

  // ─── revoke ───────────────────────────────────────────────────────────────

  describe('revoke', () => {
    it('delegates to invitationsService.revoke with invitationId and tenantId', async () => {
      // The tenantId must come from the JWT — not a body param — so one tenant
      // cannot revoke another tenant's invitation by guessing an ID.
      const user = makeJwtPayload({ tenantId: 'acme' });
      revoke.mockResolvedValue(undefined);

      await controller.revoke('inv-1', user);

      expect(revoke).toHaveBeenCalledWith('inv-1', 'acme');
    });

    it('resolves to undefined on success (maps to HTTP 204 No Content)', async () => {
      // The @HttpCode(HttpStatus.NO_CONTENT) decorator relies on a void return.
      const user = makeJwtPayload();
      revoke.mockResolvedValue(undefined);

      const result = await controller.revoke('inv-1', user);

      expect(result).toBeUndefined();
    });

    it('propagates service errors without modification', async () => {
      // Error transparency — NotFoundException from the service must reach
      // NestJS exception filters without being swallowed by the controller.
      const user = makeJwtPayload();
      revoke.mockRejectedValue(new Error('not found'));

      await expect(controller.revoke('inv-99', user)).rejects.toThrow('not found');
    });
  });
});
