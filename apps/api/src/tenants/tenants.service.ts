/**
 * @file tenants.service.ts
 * @description Business logic for tenant management.
 *
 * Stays thin: queries are scoped to the acting user's tenant or directly
 * created under them. No cross-tenant reads are permitted from this service.
 *
 * @layer tenants
 * @see docs/guidelines/nestjs-guidelines.md
 * @see docs/guidelines/prisma-guidelines.md
 */

import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, type Tenant } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateTenantDto } from './dto/create-tenant.dto.js';

/**
 * Service that manages tenant CRUD operations.
 *
 * Only exposes operations that are safe for authenticated tenant users —
 * platform-level tenant management (Phase 9) lives in `platform/`.
 *
 * @public
 */
@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lists all tenants that the given user is a member of.
   *
   * A user belongs to a tenant when a `User` row links them via `tenantId`.
   * The query is scoped to the acting user's own identity — no user can query
   * another user's memberships via this method.
   *
   * @param userId - The authenticated user's internal ID.
   * @returns Array of `Tenant` rows the user is associated with.
   */
  async listForUser(userId: string): Promise<Tenant[]> {
    return this.prisma.tenant.findMany({
      where: {
        users: { some: { id: userId } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Creates a new tenant.
   *
   * Lets the database unique constraint on `slug` be the authoritative source of
   * truth. Catching `P2002` on the insert is race-free and produces the same
   * friendly error as a pre-check would, but without the TOCTOU window.
   *
   * @param dto - Validated tenant creation payload.
   * @returns The newly created `Tenant` row.
   * @throws `ConflictException` when the slug is already taken.
   */
  async create(dto: CreateTenantDto): Promise<Tenant> {
    try {
      return await this.prisma.tenant.create({
        data: {
          name: dto.name,
          slug: dto.slug,
        },
      });
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Tenant slug '${dto.slug}' is already taken`);
      }
      throw err;
    }
  }
}
