/**
 * @file users.controller.spec.ts
 * @description Unit tests for `UsersController`.
 *
 * Verifies that:
 * - `GET /users` calls `UsersService.listByTenant` with the authenticated user's
 *   `tenantId` (cross-tenant access prevention.
 * - `PATCH /users/:id/status` calls `UsersService.updateStatus` with the correct
 *   argument order: targetId, dto, admin.tenantId, admin.id, ip, userAgent.
 * - `@Roles('ADMIN')` metadata is present on `updateStatus`.
 * - `ip` and `userAgent` default to empty strings when the header is absent.
 *
 * @layer test
 * @see apps/api/src/users/users.controller.ts
 */

import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { SelfOrAdminGuard } from '@bymax-one/nest-auth';

import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import type { TenantUserRecord } from './users.service.js';
import type { UpdateStatusDto } from './dto/update-status.dto.js';
import type { SafeAuthUser } from '@bymax-one/nest-auth';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a minimal fake `DashboardJwtPayload` for the authenticated admin. */
function makeAdmin(overrides: { sub?: string; tenantId?: string } = {}) {
  return {
    sub: overrides.sub ?? 'admin-1',
    tenantId: overrides.tenantId ?? 'tenant-1',
    role: 'ADMIN',
  };
}

/** Builds a minimal fake `TenantUserRecord` for list responses. */
function makeUserRecord(overrides: Partial<TenantUserRecord> = {}): TenantUserRecord {
  return {
    id: 'user-2',
    email: 'bob@example.test',
    name: 'Bob Test',
    role: 'MEMBER',
    status: 'ACTIVE',
    emailVerified: true,
    mfaEnabled: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Builds a minimal fake `SafeAuthUser` for update responses. */
function makeSafeUser(): SafeAuthUser {
  return {
    id: 'user-2',
    email: 'bob@example.test',
    name: 'Bob Test',
    role: 'MEMBER',
    status: 'SUSPENDED',
    tenantId: 'tenant-1',
    emailVerified: true,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('UsersController', () => {
  let controller: UsersController;
  let listByTenant: jest.Mock<() => Promise<TenantUserRecord[]>>;
  let updateStatus: jest.Mock<() => Promise<SafeAuthUser>>;

  beforeEach(async () => {
    listByTenant = jest.fn<() => Promise<TenantUserRecord[]>>();
    updateStatus = jest.fn<() => Promise<SafeAuthUser>>();

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: { listByTenant, updateStatus },
        },
        Reflector,
      ],
    })
      // SelfOrAdminGuard requires library DI (BYMAX_AUTH_OPTIONS); override so
      // the test module compiles without the full auth module.
      .overrideGuard(SelfOrAdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(UsersController);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── listByTenant ─────────────────────────────────────────────────────────

  describe('listByTenant', () => {
    it('calls service.listByTenant with user.tenantId and returns the result', async () => {
      // Scoping by JWT tenantId prevents cross-tenant data leakage regardless
      // of what the X-Tenant-Id header contains.
      const users = [makeUserRecord()];
      listByTenant.mockResolvedValue(users);
      const admin = makeAdmin({ tenantId: 'tenant-99' });

      const result = await controller.listByTenant(admin as never);

      expect(result).toBe(users);
      expect(listByTenant).toHaveBeenCalledWith('tenant-99');
    });
  });

  // ─── updateStatus ─────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('calls service.updateStatus with the correct argument order', async () => {
      // The controller must pass arguments in the exact order the service expects:
      // id, dto, admin.tenantId, admin.sub, ip, userAgent.
      const dto: UpdateStatusDto = { status: 'SUSPENDED' };
      const safeUser = makeSafeUser();
      updateStatus.mockResolvedValue(safeUser);
      const admin = makeAdmin({ sub: 'admin-7', tenantId: 'tenant-7' });

      const result = await controller.updateStatus(
        'user-target',
        dto,
        admin as never,
        '127.0.0.1',
        'Mozilla/5.0',
      );

      expect(result).toBe(safeUser);
      expect(updateStatus).toHaveBeenCalledWith(
        'user-target',
        dto,
        'tenant-7',
        'admin-7',
        '127.0.0.1',
        'Mozilla/5.0',
      );
    });

    it('passes empty strings for ip and userAgent when they are undefined', async () => {
      // NestJS may pass undefined when the header is absent; the controller
      // normalises to "" so the service never receives undefined.
      const dto: UpdateStatusDto = { status: 'BANNED' };
      updateStatus.mockResolvedValue(makeSafeUser());
      const admin = makeAdmin();

      await controller.updateStatus(
        'user-target',
        dto,
        admin as never,
        undefined as never,
        undefined as never,
      );

      expect(updateStatus).toHaveBeenCalledWith('user-target', dto, 'tenant-1', 'admin-1', '', '');
    });

    it('has @Roles("ADMIN") metadata so RolesGuard enforces the role gate', () => {
      // Removing @Roles would allow MEMBER/VIEWER users to ban or suspend
      // other members, violating RBAC.
      const roles = Reflect.getMetadata(
        'roles',
        UsersController.prototype.updateStatus as object,
      ) as string[] | undefined;

      expect(roles).toBeDefined();
      expect(roles).toContain('ADMIN');
    });
  });

  // ─── findById ─────────────────────────────────────────────────────────────

  describe('findById', () => {
    let findById: jest.Mock<() => Promise<TenantUserRecord>>;

    beforeEach(async () => {
      findById = jest.fn<() => Promise<TenantUserRecord>>();

      const moduleRef = await Test.createTestingModule({
        controllers: [UsersController],
        providers: [
          {
            provide: UsersService,
            useValue: { listByTenant: jest.fn(), updateStatus: jest.fn(), findById },
          },
          Reflector,
        ],
      })
        .overrideGuard(SelfOrAdminGuard)
        .useValue({ canActivate: () => true })
        .compile();

      controller = moduleRef.get(UsersController);
    });

    it('delegates to UsersService.findById with the correct id and tenantId', async () => {
      /**
       * Scenario: the controller must pass the URL param `id` and the JWT
       * claim `tenantId` to the service. Swapping arguments would allow
       * cross-tenant reads (privilege escalation).
       * Rule: UsersService.findById is called with (id, user.tenantId).
       */
      const record = makeUserRecord({ id: 'user-target' });
      findById.mockResolvedValue(record);
      const caller = makeAdmin({ sub: 'admin-1', tenantId: 'tenant-7' });

      const result = await controller.findById('user-target', caller as never);

      expect(findById).toHaveBeenCalledWith('user-target', 'tenant-7');
      expect(result).toBe(record);
    });

    it('propagates the service result without modification', async () => {
      /**
       * Scenario: the controller is a thin delegation layer — it must not
       * reshape or filter the service result.
       * Rule: the exact service return value reaches the caller.
       */
      const record = makeUserRecord({ id: 'user-42', name: 'Carol' });
      findById.mockResolvedValue(record);
      const caller = makeAdmin();

      const result = await controller.findById('user-42', caller as never);

      expect(result).toStrictEqual(record);
    });
  });
});
