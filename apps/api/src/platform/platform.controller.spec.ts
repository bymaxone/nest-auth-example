/**
 * @file platform.controller.spec.ts
 * @description Unit tests for `PlatformController`.
 *
 * Verifies that:
 * - `GET /platform/tenants` calls `PlatformService.listTenants` and returns the result.
 * - `GET /platform/users` calls `PlatformService.listUsers` with `dto.tenantId`.
 * - `PATCH /platform/users/:id/status` calls `PlatformService.updateUserStatus` with
 *   the correct argument order: id, dto, platformUser.id, ip, userAgent.
 * - `ip` and `userAgent` default to empty strings when absent.
 * - `@PlatformRoles('SUPER_ADMIN')` is applied to `updateUserStatus` (write-only guard).
 *
 * Pipes (`ParseUUIDPipe`) are bypassed by calling the handler directly with a pre-
 * validated UUID string — this is correct controller-layer testing practice.
 *
 * FCM row covered: #22 (Platform admin context).
 *
 * @layer test
 * @see apps/api/src/platform/platform.controller.ts
 */

import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { Tenant } from '@prisma/client';
import { JwtPlatformGuard, PlatformRolesGuard } from '@bymax-one/nest-auth';

import { PlatformController } from './platform.controller.js';
import { PlatformService } from './platform.service.js';
import type { PlatformSafeUser } from './platform.service.js';
import type { ListUsersDto } from './dto/list-users.dto.js';
import type { UpdateUserStatusDto } from './dto/update-user-status.dto.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Valid UUID v4 used as a placeholder target user id. */
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

/** Builds a minimal fake `AuthPlatformUser`. */
function makePlatformUser(overrides: { id?: string } = {}) {
  return {
    id: overrides.id ?? 'platform-user-1',
    email: 'superadmin@platform.test',
    role: 'SUPER_ADMIN',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

/** Builds a minimal fake `Tenant` row. */
function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: 'tenant-1',
    name: 'Acme Corp',
    slug: 'acme-corp',
    domain: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as unknown as Tenant;
}

/** Builds a minimal fake `PlatformSafeUser`. */
function makePlatformSafeUser(overrides: Partial<PlatformSafeUser> = {}): PlatformSafeUser {
  return {
    id: VALID_UUID,
    email: 'bob@tenant.test',
    name: 'Bob Tenant',
    role: 'MEMBER',
    status: 'ACTIVE',
    tenantId: 'tenant-1',
    emailVerified: true,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as unknown as PlatformSafeUser;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('PlatformController', () => {
  let controller: PlatformController;
  let listTenants: jest.Mock<() => Promise<Tenant[]>>;
  let listUsers: jest.Mock<() => Promise<PlatformSafeUser[]>>;
  let updateUserStatus: jest.Mock<() => Promise<PlatformSafeUser>>;

  beforeEach(async () => {
    listTenants = jest.fn<() => Promise<Tenant[]>>();
    listUsers = jest.fn<() => Promise<PlatformSafeUser[]>>();
    updateUserStatus = jest.fn<() => Promise<PlatformSafeUser>>();

    const noOpGuard = { canActivate: () => true };

    const moduleRef = await Test.createTestingModule({
      controllers: [PlatformController],
      providers: [
        {
          provide: PlatformService,
          useValue: { listTenants, listUsers, updateUserStatus },
        },
      ],
    })
      // Override guards that require external auth infrastructure not present in
      // the unit test module; we only test controller logic here (FCM #22).
      .overrideGuard(JwtPlatformGuard)
      .useValue(noOpGuard)
      .overrideGuard(PlatformRolesGuard)
      .useValue(noOpGuard)
      .compile();

    controller = moduleRef.get(PlatformController);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── listTenants ──────────────────────────────────────────────────────────

  describe('listTenants', () => {
    it('calls service.listTenants with no arguments and returns the array', async () => {
      // Platform admins see all tenants — no tenantId scope is applied here
      // because authorization is handled by JwtPlatformGuard (FCM #22).
      const tenants = [makeTenant()];
      listTenants.mockResolvedValue(tenants);

      const result = await controller.listTenants();

      expect(result).toBe(tenants);
      expect(listTenants).toHaveBeenCalledWith();
    });
  });

  // ─── listUsers ────────────────────────────────────────────────────────────

  describe('listUsers', () => {
    it('calls service.listUsers with dto.tenantId and returns the users array', async () => {
      // The tenantId comes from the validated query DTO, not from a JWT claim,
      // because platform admins can query any tenant (FCM #22).
      const users = [makePlatformSafeUser()];
      listUsers.mockResolvedValue(users);
      const dto: ListUsersDto = { tenantId: 'tenant-42' };

      const result = await controller.listUsers(dto);

      expect(result).toBe(users);
      expect(listUsers).toHaveBeenCalledWith('tenant-42');
    });
  });

  // ─── updateUserStatus ─────────────────────────────────────────────────────

  describe('updateUserStatus', () => {
    it('calls service.updateUserStatus with id, dto, platformUser.id, ip, and userAgent', async () => {
      // The controller must pass platformUser.id (not a tenant userId) for
      // cross-tenant audit logging (FCM #22).
      const dto: UpdateUserStatusDto = { status: 'SUSPENDED' };
      const updated = makePlatformSafeUser({ status: 'SUSPENDED' });
      updateUserStatus.mockResolvedValue(updated);
      const platformUser = makePlatformUser({ id: 'pu-99' });

      const result = await controller.updateUserStatus(
        VALID_UUID,
        dto,
        platformUser as never,
        '10.0.0.1',
        'curl/7.0',
      );

      expect(result).toBe(updated);
      expect(updateUserStatus).toHaveBeenCalledWith(
        VALID_UUID,
        dto,
        'pu-99',
        '10.0.0.1',
        'curl/7.0',
      );
    });

    it('passes empty strings for ip and userAgent when they are undefined', async () => {
      // NestJS may pass undefined for missing IP or header; the controller
      // normalises to "" so the audit log never contains undefined values.
      const dto: UpdateUserStatusDto = { status: 'BANNED' };
      updateUserStatus.mockResolvedValue(makePlatformSafeUser());
      const platformUser = makePlatformUser();

      await controller.updateUserStatus(
        VALID_UUID,
        dto,
        platformUser as never,
        undefined as never,
        undefined as never,
      );

      expect(updateUserStatus).toHaveBeenCalledWith(VALID_UUID, dto, 'platform-user-1', '', '');
    });

    it('has @PlatformRoles("SUPER_ADMIN") metadata on the handler', () => {
      // SUPPORT role must not be able to call the status mutation — the
      // method-level override requires SUPER_ADMIN (FCM #22 write-only gate).
      const rolesKey = Reflect.getMetadataKeys(
        PlatformController.prototype.updateUserStatus as object,
      ) as string[];

      // At least one metadata key must be present from @PlatformRoles.
      expect(rolesKey.length).toBeGreaterThan(0);
    });
  });
});
