/**
 * @file projects.service.spec.ts
 * @description Unit tests for `ProjectsService`.
 *
 * Verifies:
 * - `listByTenant` always passes tenantId in the WHERE clause.
 * - `create` passes the correct data, ownerUserId, and tenantId.
 * - `delete` uses an atomic `deleteMany({ id, tenantId })` and throws
 *   `NotFoundException` when no row is affected — preventing cross-tenant leaks.
 *
 * FCM rows covered: #18 (RBAC), #20 (multi-tenant isolation).
 *
 * @layer test
 * @see apps/api/src/projects/projects.service.ts
 */

import { NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { Project } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectsService } from './projects.service.js';
import type { CreateProjectDto } from './dto/create-project.dto.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a minimal valid `Project` row. */
function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    tenantId: 'acme',
    ownerUserId: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('ProjectsService', () => {
  let service: ProjectsService;
  let projectFindMany: jest.Mock<() => Promise<Project[]>>;
  let projectCreate: jest.Mock<() => Promise<Project>>;
  let projectDeleteMany: jest.Mock<() => Promise<{ count: number }>>;

  beforeEach(async () => {
    projectFindMany = jest.fn<() => Promise<Project[]>>();
    projectCreate = jest.fn<() => Promise<Project>>();
    projectDeleteMany = jest.fn<() => Promise<{ count: number }>>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectsService,
        {
          provide: PrismaService,
          useValue: {
            project: {
              findMany: projectFindMany,
              create: projectDeleteMany, // overridden per describe
              deleteMany: projectDeleteMany,
            },
          },
        },
      ],
    }).compile();

    service = moduleRef.get(ProjectsService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── listByTenant ───────────────────────────────────────────────────────────

  describe('listByTenant', () => {
    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          ProjectsService,
          {
            provide: PrismaService,
            useValue: {
              project: { findMany: projectFindMany },
            },
          },
        ],
      }).compile();
      service = moduleRef.get(ProjectsService);
    });

    it('returns the array from prisma.project.findMany scoped to the given tenantId', async () => {
      // Every findMany call must pass tenantId in WHERE to prevent cross-tenant reads (FCM #20).
      const projects = [makeProject(), makeProject({ id: 'proj-2' })];
      projectFindMany.mockResolvedValue(projects);

      const result = await service.listByTenant('acme');

      expect(result).toBe(projects);
      expect(projectFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'acme' } }),
      );
    });

    it('returns an empty array when no projects belong to the tenant', async () => {
      // The tenant isolation guarantee holds regardless of result size.
      projectFindMany.mockResolvedValue([]);

      const result = await service.listByTenant('empty-tenant');

      expect(result).toEqual([]);
      expect(projectFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'empty-tenant' } }),
      );
    });

    it('orders the project list by createdAt descending (newest first)', async () => {
      /*
       * Scenario: the dashboard's project list shows the most
       * recently created project at the top so the user can
       * see what they just created. A drift that emptied the
       * orderBy clause would let Prisma return rows in
       * indeterminate order — visibly broken on every page load.
       */
      projectFindMany.mockResolvedValue([]);

      await service.listByTenant('acme');

      const calls = projectFindMany.mock.calls as unknown as Array<
        [{ orderBy: { createdAt: string } }]
      >;
      expect(calls[0]?.[0].orderBy).toEqual({ createdAt: 'desc' });
    });
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          ProjectsService,
          {
            provide: PrismaService,
            useValue: {
              project: { create: projectCreate },
            },
          },
        ],
      }).compile();
      service = moduleRef.get(ProjectsService);
    });

    it('calls prisma.project.create with name, ownerUserId, and tenantId', async () => {
      // The create path must embed ownerUserId and tenantId so new projects are
      // correctly scoped to the acting user and tenant (FCM #20).
      const dto: CreateProjectDto = { name: 'New Project' };
      const created = makeProject({ name: 'New Project' });
      projectCreate.mockResolvedValue(created);

      const result = await service.create(dto, 'user-1', 'acme');

      expect(result).toBe(created);
      expect(projectCreate).toHaveBeenCalledWith({
        data: { name: 'New Project', ownerUserId: 'user-1', tenantId: 'acme' },
      });
    });
  });

  // ─── delete ────────────────────────────────────────────────────────────────

  describe('delete', () => {
    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          ProjectsService,
          {
            provide: PrismaService,
            useValue: {
              project: { deleteMany: projectDeleteMany },
            },
          },
        ],
      }).compile();
      service = moduleRef.get(ProjectsService);
    });

    it('calls prisma.project.deleteMany with both projectId and tenantId', async () => {
      // The atomic deleteMany({ id, tenantId }) ensures cross-tenant deletes are
      // treated as not-found rather than forbidden — anti-enumeration (FCM #20).
      projectDeleteMany.mockResolvedValue({ count: 1 });

      await service.delete('proj-1', 'acme');

      expect(projectDeleteMany).toHaveBeenCalledWith({
        where: { id: 'proj-1', tenantId: 'acme' },
      });
    });

    it('resolves without error when deleteMany returns count=1', async () => {
      // Happy path — the project exists in the tenant and is deleted successfully.
      projectDeleteMany.mockResolvedValue({ count: 1 });

      await expect(service.delete('proj-1', 'acme')).resolves.toBeUndefined();
    });

    it('throws NotFoundException when deleteMany returns count=0 (not found or cross-tenant)', async () => {
      // When count is 0 the project either does not exist or belongs to a different
      // tenant. Both cases are surfaced as 404 — not 403 — to prevent enumeration.
      projectDeleteMany.mockResolvedValue({ count: 0 });

      await expect(service.delete('missing-proj', 'acme')).rejects.toThrow(NotFoundException);
    });

    it('names the missing project id verbatim in the 404 message', async () => {
      /*
       * Scenario: a user clicks delete on a project that
       * another admin already removed (or that belongs to
       * another tenant). The 404 message MUST name the
       * specific project id so the audit trail and UI toast
       * surface exactly which target failed.
       */
      projectDeleteMany.mockResolvedValue({ count: 0 });

      await expect(service.delete('ghost-proj', 'acme')).rejects.toThrow(
        "Project 'ghost-proj' not found",
      );
    });
  });
});
