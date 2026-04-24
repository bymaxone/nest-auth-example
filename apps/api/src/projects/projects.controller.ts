/**
 * @file projects.controller.ts
 * @description HTTP controller for tenant-scoped project endpoints.
 *
 * Demonstrates FCM rows:
 * - #18 (RBAC): `@Roles('ADMIN')` gates project creation.
 * - #19 (decorators): `@CurrentUser()` injects the authenticated user.
 * - #20 (multi-tenant): every service call passes `user.tenantId` so rows are
 *   always scoped to the current tenant — never a bare `findMany`.
 *
 * `DELETE /:id` is open to any authenticated tenant member — tenant isolation is
 * enforced atomically in the service via `deleteMany({ id, tenantId })`.
 *
 * @layer projects
 * @see docs/guidelines/nestjs-guidelines.md
 * @see docs/guidelines/nest-auth-guidelines.md
 */

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import type { Project } from '@prisma/client';
import { CurrentUser, Roles } from '@bymax-one/nest-auth';
import type { AuthUser } from '@bymax-one/nest-auth';

import { ProjectsService } from './projects.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';

/**
 * Handles `/api/projects` routes.
 *
 * All routes require an authenticated JWT (global `JwtAuthGuard`).
 * `POST /api/projects` additionally requires the `ADMIN` role.
 * `DELETE /api/projects/:id` is open to any authenticated tenant member.
 *
 * @public
 */
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  /**
   * Lists all projects in the authenticated user's tenant.
   *
   * Tenant scoping is enforced at the service layer via `user.tenantId` —
   * a user can never read another tenant's projects through this endpoint.
   *
   * GET /api/projects
   *
   * @param user - Authenticated user injected by `@CurrentUser()`.
   * @returns Tenant-scoped project list.
   */
  @Get()
  list(@CurrentUser() user: AuthUser): Promise<Project[]> {
    return this.projectsService.listByTenant(user.tenantId);
  }

  /**
   * Creates a new project in the authenticated user's tenant.
   *
   * Restricted to `ADMIN`-role users (and OWNER by hierarchy) via `@Roles('ADMIN')`.
   * MEMBER and VIEWER users receive `403 FORBIDDEN` from `RolesGuard` before
   * this handler is invoked.
   *
   * POST /api/projects
   *
   * @param dto - Validated creation payload.
   * @param user - Authenticated user injected by `@CurrentUser()`.
   * @returns The newly created project.
   */
  @Post()
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: AuthUser): Promise<Project> {
    return this.projectsService.create(dto, user.id, user.tenantId);
  }

  /**
   * Deletes a project by ID.
   *
   * Any authenticated tenant member may delete a project within their tenant.
   * Tenant isolation is enforced atomically in the service via `deleteMany` with
   * `{ id, tenantId }` in the WHERE clause — a project in a different tenant
   * is treated as not found (anti-enumeration, returns 404 for both cases).
   *
   * DELETE /api/projects/:id
   *
   * @param id - The project's unique identifier (from URL param).
   * @param user - Authenticated user injected by `@CurrentUser()`.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<void> {
    await this.projectsService.delete(id, user.tenantId);
  }
}
