/**
 * @file invitations.service.ts
 * @description Business logic for tenant invitation management.
 *
 * Implements a custom invitation layer on top of the library's acceptance flow:
 * - Invitation tokens are generated locally (`generateSecureToken(32)`) and stored
 *   in Redis under `{namespace}:inv:{sha256(token)}` in the format the library's
 *   `POST /auth/invitations/accept` endpoint expects.
 * - A Prisma `Invitation` record is written alongside the Redis entry so callers
 *   can list and revoke pending invitations (the library's built-in invitation
 *   controller only exposes create + accept).
 *
 * The raw token is passed to `IEmailProvider.sendInvitation()` to embed in the
 * accept-invitation link. It is never stored server-side.
 *
 * Token TTL: 48 hours (172 800 seconds) — must match `auth.config.ts`'s
 * `invitations.tokenTtlSeconds` value so Redis and Prisma `expiresAt` agree.
 *
 * @layer invitations
 * @see docs/guidelines/nestjs-guidelines.md
 * @see docs/guidelines/security-privacy-guidelines.md
 */

import { Inject, Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Redis } from 'ioredis';
import {
  BYMAX_AUTH_REDIS_CLIENT,
  BYMAX_AUTH_EMAIL_PROVIDER,
  generateSecureToken,
  sha256,
  hasRole,
  type IEmailProvider,
} from '@bymax-one/nest-auth';

import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateInvitationDto } from './dto/create-invitation.dto.js';

/** Must match `auth.config.ts` → `invitations.tokenTtlSeconds`. */
const INVITE_TTL_SECONDS = 172_800;

/** Redis key namespace — must match `auth.config.ts` → `redisNamespace`. */
const REDIS_NAMESPACE = 'nest-auth-example';

/** Role hierarchy — must mirror `auth.config.ts` → `roles.hierarchy`. */
const ROLE_HIERARCHY: Record<string, string[]> = {
  OWNER: ['ADMIN', 'MEMBER', 'VIEWER'],
  ADMIN: ['MEMBER', 'VIEWER'],
  MEMBER: ['VIEWER'],
  VIEWER: [],
};

/**
 * Safe invitation record returned by list and create endpoints.
 *
 * @public
 */
export interface InvitationRecord {
  id: string;
  email: string;
  role: string;
  invitedByUserId: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Manages tenant invitations — create, list, and revoke.
 *
 * @public
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(BYMAX_AUTH_REDIS_CLIENT)
    private readonly redis: Redis,
    @Inject(BYMAX_AUTH_EMAIL_PROVIDER)
    private readonly emailProvider: IEmailProvider,
  ) {}

  /**
   * Creates a new tenant invitation, stores it in Redis + Prisma, and emails the invitee.
   *
   * The inviter must hold a role equal to or higher than the requested `role`.
   * The raw token is embedded in the invitation email and never persisted server-side;
   * only its SHA-256 hex digest is stored (in both Redis and Prisma) for lookup.
   *
   * @param inviterUserId - ID of the authenticated user creating the invitation.
   * @param tenantId      - Tenant scope (from JWT claim — never from request body).
   * @param dto           - Validated email + role.
   * @throws `ForbiddenException` when the inviter does not hold a sufficient role.
   * @throws `NotFoundException` when the inviter or tenant record is missing.
   */
  async create(
    inviterUserId: string,
    tenantId: string,
    dto: CreateInvitationDto,
  ): Promise<InvitationRecord> {
    // Resolve inviter and tenant for display names used in the email.
    const [inviter, tenant] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: inviterUserId, tenantId },
        select: { id: true, name: true, role: true },
      }),
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true },
      }),
    ]);

    if (inviter === null) throw new NotFoundException('Inviter not found');
    if (tenant === null) throw new NotFoundException('Tenant not found');

    // Verify the inviter holds a sufficient role to grant the requested role.
    if (!hasRole(inviter.role, dto.role, ROLE_HIERARCHY)) {
      throw new ForbiddenException(
        `Your role (${inviter.role}) cannot invite users with role ${dto.role}.`,
      );
    }

    const normalizedEmail = dto.email.trim().toLowerCase();
    const rawToken = generateSecureToken(32);
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_TTL_SECONDS * 1000);

    const redisKey = `${REDIS_NAMESPACE}:inv:${tokenHash}`;
    const redisPayload = JSON.stringify({
      email: normalizedEmail,
      role: dto.role,
      tenantId,
      inviterUserId,
      createdAt: new Date().toISOString(),
    });

    // Store in Redis — this is the entry the library's accept endpoint will consume.
    await this.redis.set(redisKey, redisPayload, 'EX', INVITE_TTL_SECONDS);

    // Store in Prisma for list and revoke operations.
    const invitation = await this.prisma.invitation.create({
      data: {
        tenantId,
        email: normalizedEmail,
        role: dto.role,
        token: tokenHash,
        invitedByUserId: inviterUserId,
        expiresAt,
      },
      select: {
        id: true,
        email: true,
        role: true,
        invitedByUserId: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    // Send the invitation email — non-blocking failure must not abort the flow.
    try {
      await this.emailProvider.sendInvitation(normalizedEmail, {
        inviterName: inviter.name,
        tenantName: tenant.name,
        inviteToken: rawToken,
        expiresAt,
      });
    } catch (err: unknown) {
      this.logger.error({
        msg: 'invitations: email delivery failed',
        invitationId: invitation.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return invitation;
  }

  /**
   * Returns all pending, non-expired invitations for a tenant.
   *
   * Invitations are ordered by creation date descending (newest first).
   *
   * @param tenantId - Tenant scope.
   */
  async listByTenant(tenantId: string): Promise<InvitationRecord[]> {
    return this.prisma.invitation.findMany({
      where: {
        tenantId,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        email: true,
        role: true,
        invitedByUserId: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Revokes a pending invitation by deleting the Prisma record.
   *
   * The corresponding Redis entry will expire naturally at its TTL. Tenant
   * ownership is validated before deletion — cross-tenant revocation returns 404.
   *
   * @param id       - Invitation ID.
   * @param tenantId - Tenant scope of the acting admin.
   * @throws `NotFoundException` when the invitation is not found in the admin's tenant.
   */
  async revoke(id: string, tenantId: string): Promise<void> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id },
      select: { tenantId: true, token: true },
    });

    if (invitation === null || invitation.tenantId !== tenantId) {
      throw new NotFoundException(`Invitation '${id}' not found`);
    }

    await this.prisma.invitation.delete({ where: { id } });

    // Best-effort Redis cleanup — the entry will expire naturally if this fails.
    const redisKey = `${REDIS_NAMESPACE}:inv:${invitation.token}`;
    await this.redis.del(redisKey).catch((err: unknown) => {
      this.logger.warn({
        msg: 'invitations: Redis cleanup failed',
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}
