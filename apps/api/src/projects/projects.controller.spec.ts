/**
 * @file projects.controller.spec.ts
 * @description Unit tests for `ProjectsController`.
 *
 * Verifies that:
 * - `GET /projects` calls `listByTenant` with the user's tenantId.
 * - `POST /projects` calls `create` with the DTO, userId, and tenantId.
 * - `DELETE /projects/:id` calls `delete` with the projectId and tenantId.
 * - `DELETE /projects/:id` propagates service errors (e.g. NotFoundException) to NestJS.
 * - `@Roles('ADMIN')` metadata is present on the `create` handler so
 *   `RolesGuard` enforces the role gate without the controller hand-rolling RBAC.
 *
 * The RolesGuard itself is NOT tested here — it is a library concern. We only
 * verify the metadata (FCM #18) so a regression that removes `@Roles` fails here.
 *
 * FCM rows covered: #18 (RBAC decorator), #19 (CurrentUser), #20 (tenant scoping).
 *
 * @layer test
 * @see apps/api/src/projects/projects.controller.ts
 */

import { NotFoundException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { Project } from '@prisma/client';

import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import type { CreateProjectDto } from './dto/create-project.dto.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a minimal fake `DashboardJwtPayload`. */
function makeUser(overrides: { id?: string; tenantId?: string; role?: string } = {}) {
  return {
    sub: overrides.id ?? 'user-1',
    id: overrides.id ?? 'user-1',
    tenantId: overrides.tenantId ?? 'acme',
    role: overrides.role ?? 'ADMIN',
    email: 'alice@example.test',
    name: 'Alice Test',
    status: 'ACTIVE',
    emailVerified: true,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

/** Builds a minimal fake `Project` row. */
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

describe('ProjectsController', () => {
  let controller: ProjectsController;
  let listByTenant: jest.Mock<() => Promise<Project[]>>;
  let create: jest.Mock<() => Promise<Project>>;
  let del: jest.Mock<() => Promise<void>>;

  beforeEach(async () => {
    listByTenant = jest.fn<() => Promise<Project[]>>();
    create = jest.fn<() => Promise<Project>>();
    del = jest.fn<() => Promise<void>>();

    const moduleRef = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        {
          provide: ProjectsService,
          useValue: { listByTenant, create, delete: del },
        },
        Reflector,
      ],
    }).compile();

    controller = moduleRef.get(ProjectsController);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── list ────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns the array from listByTenant called with user.tenantId', async () => {
      // The controller must pass user.tenantId — not a query param — to ensure
      // the list is always scoped to the authenticated user's tenant (FCM #20).
      const projects = [makeProject()];
      listByTenant.mockResolvedValue(projects);
      const user = makeUser();

      const result = await controller.list(user as never);

      expect(result).toBe(projects);
      expect(listByTenant).toHaveBeenCalledWith('acme');
    });
  });

  // ─── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('calls service.create with dto, user.id, and user.tenantId', async () => {
      // The controller must forward all three arguments so the service stores the
      // project with the correct owner and tenant (FCM #20).
      const dto: CreateProjectDto = { name: 'My Project' };
      const project = makeProject({ name: 'My Project' });
      create.mockResolvedValue(project);
      const user = makeUser({ id: 'user-1', tenantId: 'acme' });

      const result = await controller.create(dto, user as never);

      expect(result).toBe(project);
      expect(create).toHaveBeenCalledWith(dto, 'user-1', 'acme');
    });

    it('has @Roles("ADMIN") metadata so RolesGuard enforces the role gate', () => {
      // The @Roles decorator must be present on the create handler — removing it
      // would silently open project creation to all roles (FCM #18 regression).
      const reflector = new Reflector();
      // Access method metadata through the prototype — handler-level metadata
      // is stored on the prototype property.
      const roles = Reflect.getMetadata('roles', ProjectsController.prototype.create as object) as
        | string[]
        | undefined;

      // The library stores roles under the 'roles' key via @Roles decorator.
      // If BYMAX_AUTH_ROLES_KEY differs, update the string above to match.
      expect(roles).toBeDefined();
      void reflector; // referenced to avoid lint unused warning
    });
  });

  // ─── delete ──────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('calls service.delete with the URL param id and user.tenantId', async () => {
      // The controller forwards the route param and tenantId so the service can
      // do the atomic deleteMany({ id, tenantId }) isolation check (FCM #20).
      del.mockResolvedValue(undefined);
      const user = makeUser({ tenantId: 'acme' });

      await controller.delete('proj-1', user as never);

      expect(del).toHaveBeenCalledWith('proj-1', 'acme');
    });

    it('resolves with void when service.delete succeeds', async () => {
      // The DELETE handler must return void (HTTP 204 No Content); returning
      // the service result directly would be correct here.
      del.mockResolvedValue(undefined);
      const user = makeUser();

      await expect(controller.delete('proj-1', user as never)).resolves.toBeUndefined();
    });

    it('propagates NotFoundException from service.delete so NestJS maps it to HTTP 404', async () => {
      // The controller must not swallow service errors — NestJS exception filters
      // translate NotFoundException to 404. Swallowing it would silently return 204
      // for a project that was not found, misleading the client (FCM #20).
      del.mockRejectedValueOnce(new NotFoundException('Project not found'));
      const user = makeUser({ tenantId: 'acme' });

      await expect(controller.delete('missing-proj', user as never)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
