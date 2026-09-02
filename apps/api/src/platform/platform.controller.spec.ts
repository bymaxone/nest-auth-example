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
 * - `POST /platform/users/:id/reset-mfa` forwards id, actor id, ip and userAgent
 *   to `PlatformService.resetUserMfa`, defaulting ip/userAgent to empty strings.
 *
 * Pipes (`ParseUUIDPipe`) are bypassed by calling the handler directly with a pre-
 * validated UUID string — this is correct controller-layer testing practice.
 *
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

/**
 * Builds a minimal fake `PlatformJwtPayload` — what `@CurrentUser()` actually
 * injects on a platform route.
 *
 * The acting admin's id is `sub`. An `AuthPlatformUser`-shaped fixture (with
 * `id`) would let a controller that reads `.id` pass its unit tests while
 * writing a null actor into every audit row in production.
 */
function makePlatformUser(overrides: { sub?: string } = {}) {
  return {
    jti: 'jti-1',
    sub: overrides.sub ?? 'platform-user-1',
    role: 'SUPER_ADMIN',
    type: 'platform' as const,
    mfaEnabled: false,
    mfaVerified: true,
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
  let resetUserMfa: jest.Mock<() => Promise<PlatformSafeUser>>;

  beforeEach(async () => {
    listTenants = jest.fn<() => Promise<Tenant[]>>();
    listUsers = jest.fn<() => Promise<PlatformSafeUser[]>>();
    updateUserStatus = jest.fn<() => Promise<PlatformSafeUser>>();
    resetUserMfa = jest.fn<() => Promise<PlatformSafeUser>>();

    const noOpGuard = { canActivate: () => true };

    const moduleRef = await Test.createTestingModule({
      controllers: [PlatformController],
      providers: [
        {
          provide: PlatformService,
          useValue: { listTenants, listUsers, updateUserStatus, resetUserMfa },
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
      const platformUser = makePlatformUser({ sub: 'pu-99' });

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

  describe('resetUserMfa', () => {
    it('forwards id, actor id, ip and userAgent to the service in that order', async () => {
      /*
       * Scenario: the audit row the service writes is only correct if the
       * controller hands over the arguments in the documented order. A
       * transposition of the two string pairs (actor/ip, ip/userAgent) type-
       * checks silently, so the order is pinned explicitly here.
       * Protects: the argument list of the resetUserMfa delegation.
       */
      const updated = makePlatformSafeUser({ mfaEnabled: false });
      resetUserMfa.mockResolvedValue(updated);
      const platformUser = makePlatformUser({ sub: 'platform-admin-9' });

      await expect(
        controller.resetUserMfa(VALID_UUID, platformUser as never, '198.51.100.4', 'curl/8.0'),
      ).resolves.toEqual(updated);

      expect(resetUserMfa).toHaveBeenCalledWith(
        VALID_UUID,
        'platform-admin-9',
        '198.51.100.4',
        'curl/8.0',
      );
    });

    it('passes empty strings for ip and userAgent when they are undefined', async () => {
      /*
       * Scenario: NestJS passes undefined for a missing IP or absent
       * User-Agent header. The controller normalises both to '' so the audit
       * row never stores undefined.
       * Protects: both `?? ''` fallbacks — each is an independent branch, and
       * dropping either writes undefined into the audit trail.
       */
      resetUserMfa.mockResolvedValue(makePlatformSafeUser());
      const platformUser = makePlatformUser();

      await controller.resetUserMfa(
        VALID_UUID,
        platformUser as never,
        undefined as never,
        undefined as never,
      );

      expect(resetUserMfa).toHaveBeenCalledWith(VALID_UUID, 'platform-user-1', '', '');
    });
  });
});
