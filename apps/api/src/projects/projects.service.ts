/**
 * @file projects.service.ts
 * @description Business logic for the toy `Project` domain.
 *
 * Every query is scoped to a `tenantId` parameter — no operation touches
 * rows belonging to another tenant. This file is a reference implementation
 * of tenant-safe data access for FCM row #20 (multi-tenant isolation).
 *
 * Repositories are the only layer that calls `PrismaService` directly.
 * Projects has no separate repository class because the queries are trivial and
 * the service acts as its own thin persistence layer in this demo context.
 *
 * @layer projects
 * @see docs/guidelines/nestjs-guidelines.md
 * @see docs/guidelines/prisma-guidelines.md
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import type { Project } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateProjectDto } from './dto/create-project.dto.js';

/**
 * Service that manages CRUD operations for tenant-scoped projects.
 *
 * @public
 */
@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns all projects belonging to the specified tenant.
   *
   * @param tenantId - The tenant whose projects to list. Must match the acting user's tenant.
   * @returns Array of projects sorted by creation date (newest first).
   */
  async listByTenant(tenantId: string): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Creates a new project inside the specified tenant.
   *
   * @param dto - Validated creation payload.
   * @param ownerUserId - ID of the user creating the project (becomes the owner).
   * @param tenantId - Tenant scope for the new project.
   * @returns The newly created `Project` row.
   */
  async create(dto: CreateProjectDto, ownerUserId: string, tenantId: string): Promise<Project> {
    return this.prisma.project.create({
      data: {
        name: dto.name,
        ownerUserId,
        tenantId,
      },
    });
  }

  /**
   * Deletes a project.
   *
   * Uses an atomic `deleteMany` with `{ id, tenantId }` in the WHERE clause so
   * the tenant check and the delete happen in a single round-trip. This eliminates
   * the TOCTOU race that a separate `findUnique` + `delete` pair would introduce.
   * A zero-count result is returned as 404 regardless of whether the project
   * does not exist or belongs to a different tenant (anti-enumeration).
   *
   * @param projectId - ID of the project to delete.
   * @param tenantId - The acting user's tenant; only projects in this tenant are deleted.
   * @throws `NotFoundException` when no matching project is found (or cross-tenant).
   */
  async delete(projectId: string, tenantId: string): Promise<void> {
    const result = await this.prisma.project.deleteMany({
      where: { id: projectId, tenantId },
    });
    if (result.count === 0) {
      throw new NotFoundException(`Project '${projectId}' not found`);
    }
  }
}
