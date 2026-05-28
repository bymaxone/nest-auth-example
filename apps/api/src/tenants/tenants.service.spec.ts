/**
 * @file tenants.service.spec.ts
 * @description Unit tests for `TenantsService`.
 *
 * Verifies:
 * - `listForUser` scopes the query to the acting user's own memberships.
 * - `create` writes name and slug, propagates unknown DB errors, and converts
 *   Prisma `P2002` (unique violation) to `ConflictException` — race-safe slug check.
 *
 * FCM rows covered: #18 (RBAC), #20 (multi-tenant isolation).
 *
 * @layer test
 * @see apps/api/src/tenants/tenants.service.ts
 */

import { ConflictException, NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { Prisma, type Tenant } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import { TenantsService } from './tenants.service.js';
import type { CreateTenantDto } from './dto/create-tenant.dto.js';

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
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('TenantsService', () => {
  let service: TenantsService;
  let tenantFindMany: jest.Mock<() => Promise<Tenant[]>>;
  let tenantCreate: jest.Mock<() => Promise<Tenant>>;
  let tenantFindUnique: jest.Mock<() => Promise<{ id: string } | null>>;

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── listForUser ────────────────────────────────────────────────────────────

  describe('listForUser', () => {
    beforeEach(async () => {
      tenantFindMany = jest.fn<() => Promise<Tenant[]>>();

      const moduleRef = await Test.createTestingModule({
        providers: [
          TenantsService,
          {
            provide: PrismaService,
            useValue: { tenant: { findMany: tenantFindMany } },
          },
        ],
      }).compile();
      service = moduleRef.get(TenantsService);
    });

    it('returns tenants whose users array contains the given userId', async () => {
      // listForUser must scope the query to the acting user's own identity —
      // no user can enumerate another user's memberships (FCM #20).
      const tenants = [makeTenant(), makeTenant({ id: 'tenant-2', slug: 'beta' })];
      tenantFindMany.mockResolvedValue(tenants);

      const result = await service.listForUser('user-1');

      expect(result).toBe(tenants);
      expect(tenantFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { users: { some: { id: 'user-1' } } },
        }),
      );
    });

    it('returns an empty array when the user has no tenant memberships', async () => {
      // A newly created user with no tenant rows receives an empty array, not an error.
      tenantFindMany.mockResolvedValue([]);

      const result = await service.listForUser('orphan-user');

      expect(result).toEqual([]);
    });

    it('orders the workspace list by createdAt ascending (oldest first)', async () => {
      /*
       * Scenario: the workspace switcher needs a stable order
       * so the user sees their oldest workspace first. A drift
       * that emptied the orderBy clause would let Prisma return
       * rows in indeterminate order — the dropdown would jump
       * around between page loads.
       */
      tenantFindMany.mockResolvedValue([]);

      await service.listForUser('user-1');

      const calls = tenantFindMany.mock.calls as unknown as Array<
        [{ orderBy: { createdAt: string } }]
      >;
      expect(calls[0]?.[0].orderBy).toEqual({ createdAt: 'asc' });
    });
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    beforeEach(async () => {
      tenantCreate = jest.fn<() => Promise<Tenant>>();

      const moduleRef = await Test.createTestingModule({
        providers: [
          TenantsService,
          {
            provide: PrismaService,
            useValue: { tenant: { create: tenantCreate } },
          },
        ],
      }).compile();
      service = moduleRef.get(TenantsService);
    });

    it('calls prisma.tenant.create with the correct name and slug', async () => {
      // The create path stores name and slug exactly as validated — no
      // transforms are applied at the service layer.
      const dto: CreateTenantDto = { name: 'Acme Corp', slug: 'acme' };
      const tenant = makeTenant();
      tenantCreate.mockResolvedValue(tenant);

      const result = await service.create(dto);

      expect(result).toBe(tenant);
      expect(tenantCreate).toHaveBeenCalledWith({
        data: { name: 'Acme Corp', slug: 'acme' },
      });
    });

    it('throws ConflictException when Prisma raises P2002 (duplicate slug)', async () => {
      // The slug unique constraint is enforced at the DB level; catching P2002 here
      // is race-free (no TOCTOU between a check and an insert).
      const dto: CreateTenantDto = { name: 'Acme Corp', slug: 'acme' };
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
      });
      tenantCreate.mockRejectedValue(p2002);

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('names the offending slug verbatim in the duplicate-slug 409 message', async () => {
      /*
       * Scenario: an admin tries to create a tenant with a slug
       * already in use. The 409 response MUST name the
       * offending slug so the admin's form can surface the
       * exact validation message under the slug field — a
       * generic "slug taken" would leave the user guessing.
       */
      const dto: CreateTenantDto = { name: 'Acme Two', slug: 'acme-taken' };
      const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
      });
      tenantCreate.mockRejectedValue(p2002);

      await expect(service.create(dto)).rejects.toThrow(
        "Tenant slug 'acme-taken' is already taken",
      );
    });

    it('rethrows non-P2002 Prisma errors without wrapping them', async () => {
      // Unknown DB errors (P2003 FK violation, P2025 not found, etc.) must bubble
      // up unchanged so NestJS error handlers see the original error class.
      const dto: CreateTenantDto = { name: 'Acme Corp', slug: 'acme' };
      const dbError = new Error('Unexpected DB failure');
      tenantCreate.mockRejectedValue(dbError);

      await expect(service.create(dto)).rejects.toThrow('Unexpected DB failure');
    });

    it('rethrows PrismaClientKnownRequestError with a code other than P2002', async () => {
      // The catch block only converts P2002; all other known-request-error codes
      // must be rethrown verbatim so callers can handle them appropriately.
      const dto: CreateTenantDto = { name: 'Acme Corp', slug: 'acme' };
      const otherError = new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '5.0.0',
      });
      tenantCreate.mockRejectedValue(otherError);

      await expect(service.create(dto)).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    });
  });

  // ─── resolveBySlug ─────────────────────────────────────────────────────────

  describe('resolveBySlug', () => {
    beforeEach(async () => {
      tenantFindUnique = jest.fn<() => Promise<{ id: string } | null>>();

      const moduleRef = await Test.createTestingModule({
        providers: [
          TenantsService,
          {
            provide: PrismaService,
            useValue: { tenant: { findUnique: tenantFindUnique } },
          },
        ],
      }).compile();
      service = moduleRef.get(TenantsService);
    });

    it('returns the tenant CUID when the slug matches an existing tenant', async () => {
      // resolveBySlug powers the public /api/tenants/resolve endpoint that the
      // login page calls to convert a URL slug into the CUID required by the
      // X-Tenant-Id header — the only output is the CUID, never name/domain.
      tenantFindUnique.mockResolvedValue({ id: 'cuid-acme' });

      const result = await service.resolveBySlug('acme');

      expect(result).toEqual({ id: 'cuid-acme' });
      expect(tenantFindUnique).toHaveBeenCalledWith({
        where: { slug: 'acme' },
        select: { id: true },
      });
    });

    it('throws NotFoundException with the slug in the message when no tenant matches', async () => {
      // The login page surfaces this 404 via TenantNotFoundError so the user
      // sees "Workspace '<slug>' was not found" instead of a misleading
      // invalid-credentials toast — the message must include the slug.
      tenantFindUnique.mockResolvedValue(null);

      await expect(service.resolveBySlug('missing')).rejects.toThrow(NotFoundException);
      await expect(service.resolveBySlug('missing')).rejects.toThrow('Tenant not found: missing');
    });
  });
});
