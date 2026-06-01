/**
 * @file tenants.controller.spec.ts
 * @description Unit tests for `TenantsController`.
 *
 * Verifies that:
 * - `GET /tenants/me` calls `TenantsService.listForUser` with the authenticated
 *   user's `id` (not `tenantId`), returning the service result.
 * - `POST /tenants` calls `TenantsService.create` with the validated DTO.
 * - `@Roles('OWNER')` metadata is present on the `create` handler so that a
 *   regression removing the decorator causes this test to fail.
 *
 *
 * @layer test
 * @see apps/api/src/tenants/tenants.controller.ts
 */

import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { Tenant } from '@prisma/client';

import { TenantsController } from './tenants.controller.js';
import { TenantsService } from './tenants.service.js';
import type { CreateTenantDto } from './dto/create-tenant.dto.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a minimal fake `DashboardJwtPayload`. */
function makeUser(overrides: { id?: string; tenantId?: string } = {}) {
  return {
    sub: overrides.id ?? 'user-1',
    id: overrides.id ?? 'user-1',
    tenantId: overrides.tenantId ?? 'tenant-1',
    role: 'OWNER',
    email: 'alice@example.test',
    name: 'Alice Test',
    status: 'ACTIVE',
    emailVerified: true,
    mfaEnabled: false,
    lastLoginAt: null,
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

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('TenantsController', () => {
  let controller: TenantsController;
  let listForUser: jest.Mock<() => Promise<Tenant[]>>;
  let create: jest.Mock<() => Promise<Tenant>>;
  let resolveBySlug: jest.Mock<() => Promise<{ id: string }>>;

  beforeEach(async () => {
    listForUser = jest.fn<() => Promise<Tenant[]>>();
    create = jest.fn<() => Promise<Tenant>>();
    resolveBySlug = jest.fn<() => Promise<{ id: string }>>();

    const moduleRef = await Test.createTestingModule({
      controllers: [TenantsController],
      providers: [
        {
          provide: TenantsService,
          useValue: { listForUser, create, resolveBySlug },
        },
        Reflector,
      ],
    }).compile();

    controller = moduleRef.get(TenantsController);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── listForMe ────────────────────────────────────────────────────────────

  describe('listForMe', () => {
    it('calls service.listForUser with user.id and returns the tenants array', async () => {
      // The list must be scoped to the authenticated user by their id (not
      // tenantId) so multi-tenant membership is surfaced correctly (FCM #19).
      const tenants = [makeTenant()];
      listForUser.mockResolvedValue(tenants);
      const user = makeUser({ id: 'user-42' });

      const result = await controller.listForMe(user as never);

      expect(result).toBe(tenants);
      expect(listForUser).toHaveBeenCalledWith('user-42');
    });
  });

  // ─── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('calls service.create with the validated DTO and returns the new tenant', async () => {
      // The controller must forward the entire DTO to the service without
      // modification; business logic lives in the service, not the controller.
      const dto: CreateTenantDto = { name: 'New Corp', slug: 'new-corp' };
      const tenant = makeTenant({ name: 'New Corp', slug: 'new-corp' });
      create.mockResolvedValue(tenant);

      const result = await controller.create(dto);

      expect(result).toBe(tenant);
      expect(create).toHaveBeenCalledWith(dto);
    });

    it('has @Roles("OWNER") metadata so RolesGuard enforces the role gate', () => {
      // Removing @Roles would silently open tenant creation to MEMBER/VIEWER
      // roles, violating the FCM #18 RBAC requirement.
      const roles = Reflect.getMetadata('roles', TenantsController.prototype.create as object) as
        | string[]
        | undefined;

      expect(roles).toBeDefined();
      expect(roles).toContain('OWNER');
    });
  });

  // ─── resolveBySlug ────────────────────────────────────────────────────────

  describe('resolveBySlug', () => {
    it('delegates to service.resolveBySlug and returns the CUID payload', async () => {
      // The endpoint is intentionally @Public() so the unauthenticated login
      // page can resolve `?tenantId=<slug>` to the CUID required by the
      // X-Tenant-Id header before any credentials are submitted.
      resolveBySlug.mockResolvedValue({ id: 'cuid-acme' });

      const result = await controller.resolveBySlug('acme');

      expect(result).toEqual({ id: 'cuid-acme' });
      expect(resolveBySlug).toHaveBeenCalledWith('acme');
    });
  });
});
