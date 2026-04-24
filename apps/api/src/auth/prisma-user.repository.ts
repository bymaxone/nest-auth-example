/**
 * @file prisma-user.repository.ts
 * @description Prisma-backed implementation of `IUserRepository` for tenant users.
 *
 * Acts as a thin translation layer between the Prisma `User` model and the
 * `AuthUser` shape required by `@bymax-one/nest-auth`. No business logic lives
 * here — only persistence and field mapping.
 *
 * Critical invariants:
 * - `passwordHash`, `mfaSecret`, and `mfaRecoveryCodes` are stored and returned
 *   verbatim — the library owns hashing/encryption; this class never transforms them.
 * - Every query that returns a user is scoped by `tenantId` to prevent cross-tenant leaks.
 * - Email is stored lower-case on write and returned as-is from the DB.
 *
 * Covers FCM row #32 (custom user repository).
 *
 * @layer auth
 * @see docs/guidelines/prisma-guidelines.md
 * @see docs/guidelines/nest-auth-guidelines.md
 */

import { Injectable } from '@nestjs/common';
import type {
  AuthUser,
  CreateUserData,
  CreateWithOAuthData,
  IUserRepository,
  UpdateMfaData,
} from '@bymax-one/nest-auth';
import { Role, UserStatus, type User } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Prisma-backed user repository for the tenant (dashboard) auth context.
 *
 * Injected via `BYMAX_AUTH_USER_REPOSITORY` token in Phase 7's `AuthModule`.
 * Repositories are the only layer that imports `PrismaService` directly.
 *
 * @public
 */
@Injectable()
export class PrismaUserRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Maps a Prisma `User` row to the `AuthUser` shape expected by the library.
   *
   * Optional fields (`mfaSecret`, `mfaRecoveryCodes`, `oauthProvider`,
   * `oauthProviderId`) are omitted (not set to `undefined`) when absent, as
   * required by `exactOptionalPropertyTypes: true`.
   *
   * @param row - Raw Prisma `User` row including all fields.
   * @returns An `AuthUser` without any Prisma-only fields (`updatedAt`).
   */
  private toAuthUser(row: User): AuthUser {
    const base: AuthUser = {
      id: row.id,
      email: row.email,
      name: row.name,
      passwordHash: row.passwordHash,
      role: row.role,
      status: row.status,
      tenantId: row.tenantId,
      emailVerified: row.emailVerified,
      mfaEnabled: row.mfaEnabled,
      lastLoginAt: row.lastLoginAt,
      createdAt: row.createdAt,
    };

    // Conditionally assign optional fields — never set them to undefined.
    if (row.mfaSecret !== null) {
      base.mfaSecret = row.mfaSecret;
    }
    // Only assign mfaRecoveryCodes when MFA is enabled. The Prisma schema stores
    // an empty array [] as the default for all rows (even those who never had MFA),
    // so a bare `length > 0` check would incorrectly omit the "all codes consumed"
    // state. Using mfaEnabled as the gate is semantically correct: codes are only
    // meaningful (present or exhausted) while MFA is active on the account.
    if (row.mfaEnabled) {
      base.mfaRecoveryCodes = row.mfaRecoveryCodes;
    }
    if (row.oauthProvider !== null) {
      base.oauthProvider = row.oauthProvider;
    }
    if (row.oauthProviderId !== null) {
      base.oauthProviderId = row.oauthProviderId;
    }

    return base;
  }

  /**
   * Finds a user by their internal unique identifier, optionally scoped to a tenant.
   *
   * When `tenantId` is provided the WHERE clause includes it, preventing cross-tenant
   * rows from being fetched and deserialized into heap memory at all.
   *
   * @param id - The user's unique identifier.
   * @param tenantId - When provided, the query is scoped to this tenant at the DB level.
   * @returns The matching `AuthUser`, or null if not found or tenant mismatch.
   */
  async findById(id: string, tenantId?: string): Promise<AuthUser | null> {
    const where = tenantId !== undefined ? { id, tenantId } : { id };
    const row = await this.prisma.user.findFirst({ where });
    return row ? this.toAuthUser(row) : null;
  }

  /**
   * Finds a user by email within a specific tenant.
   *
   * Uses the compound unique index `(tenantId, email)` for an O(1) lookup.
   * The library normalises email to lower-case before calling this method.
   *
   * @param email - The user's email address.
   * @param tenantId - Tenant scope to enforce isolation.
   * @returns The matching `AuthUser`, or null if not found.
   */
  async findByEmail(email: string, tenantId: string): Promise<AuthUser | null> {
    const row = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: email.toLowerCase() } },
    });
    return row ? this.toAuthUser(row) : null;
  }

  /**
   * Creates a new local (email + password) user.
   *
   * The `passwordHash` received here is already scrypt-hashed by the library's
   * `PasswordService` — never re-hash it in this method.
   *
   * @param data - Creation payload. `passwordHash` must be a library-generated hash.
   * @returns The newly created `AuthUser`.
   */
  async create(data: CreateUserData): Promise<AuthUser> {
    const role = Object.values(Role).find((r) => r === data.role) ?? Role.MEMBER;
    const status = Object.values(UserStatus).find((s) => s === data.status) ?? UserStatus.PENDING;
    const row = await this.prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        name: data.name,
        passwordHash: data.passwordHash,
        role,
        status,
        tenantId: data.tenantId,
        emailVerified: data.emailVerified ?? false,
      },
    });
    return this.toAuthUser(row);
  }

  /**
   * Replaces the user's stored password hash.
   *
   * The `passwordHash` is already produced by the library's `PasswordService` —
   * never call bcrypt/scrypt inside this method.
   *
   * @param id - The user's unique identifier.
   * @param passwordHash - New hash from `PasswordService`. Never plaintext.
   */
  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
  }

  /**
   * Updates the user's TOTP MFA configuration.
   *
   * Writes `mfaEnabled`, `mfaSecret`, and `mfaRecoveryCodes` exactly as provided —
   * the library has already encrypted the secret and hashed the recovery codes.
   * Passing `null` clears the MFA fields (MFA disabled flow).
   *
   * @param id - The user's unique identifier.
   * @param data - New MFA state from the library.
   */
  async updateMfa(id: string, data: UpdateMfaData): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: {
        mfaEnabled: data.mfaEnabled,
        mfaSecret: data.mfaSecret,
        mfaRecoveryCodes: data.mfaRecoveryCodes ?? [],
      },
    });
  }

  /**
   * Records the current time as the user's last successful login timestamp.
   *
   * @param id - The user's unique identifier.
   */
  async updateLastLogin(id: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  /**
   * Updates the user's account lifecycle status.
   *
   * @param id - The user's unique identifier.
   * @param status - New status string (e.g. 'ACTIVE', 'SUSPENDED').
   */
  async updateStatus(id: string, status: string): Promise<void> {
    const resolvedStatus = Object.values(UserStatus).find((s) => s === status);
    if (resolvedStatus === undefined) {
      throw new Error(`Unknown UserStatus: '${status}' — library/schema mismatch`);
    }
    await this.prisma.user.update({ where: { id }, data: { status: resolvedStatus } });
  }

  /**
   * Marks the user's email address as verified or unverified.
   *
   * @param id - The user's unique identifier.
   * @param verified - True to verify, false to revoke verification.
   */
  async updateEmailVerified(id: string, verified: boolean): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { emailVerified: verified } });
  }

  /**
   * Finds a user by OAuth provider and external provider ID, scoped to a tenant.
   *
   * Uses the schema unique index `(oauthProvider, oauthProviderId)` together
   * with `tenantId` to prevent cross-tenant collisions. `findFirst` is used instead
   * of `findUnique` because `tenantId` is not part of the unique index — the composite
   * named key does not include it, so Prisma cannot use `findUnique` here.
   *
   * @param provider - OAuth provider identifier (e.g. 'google').
   * @param providerId - User's unique ID within the provider.
   * @param tenantId - Tenant scope.
   * @returns The matching `AuthUser`, or null if not found.
   */
  async findByOAuthId(
    provider: string,
    providerId: string,
    tenantId: string,
  ): Promise<AuthUser | null> {
    const row = await this.prisma.user.findFirst({
      where: { oauthProvider: provider, oauthProviderId: providerId, tenantId },
    });
    return row ? this.toAuthUser(row) : null;
  }

  /**
   * Links an existing user account to an OAuth provider identity.
   *
   * Called during the account-linking flow when a user authenticates via OAuth
   * for the first time on an existing email-password account.
   *
   * @param userId - The user's unique identifier.
   * @param provider - OAuth provider identifier (e.g. 'google').
   * @param providerId - User's unique ID within the provider.
   */
  async linkOAuth(userId: string, provider: string, providerId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { oauthProvider: provider, oauthProviderId: providerId },
    });
  }

  /**
   * Creates a new user originating from an OAuth provider.
   *
   * OAuth users have no local password (`passwordHash` is implicitly null).
   * The `emailVerified` flag should be set to `true` when the OAuth provider
   * guarantees verified email addresses (e.g. Google).
   *
   * @param data - OAuth creation payload.
   * @returns The newly created `AuthUser`.
   */
  async createWithOAuth(data: CreateWithOAuthData): Promise<AuthUser> {
    const role = Object.values(Role).find((r) => r === data.role) ?? Role.MEMBER;
    const status = Object.values(UserStatus).find((s) => s === data.status) ?? UserStatus.ACTIVE;
    const row = await this.prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        name: data.name,
        passwordHash: null,
        role,
        status,
        tenantId: data.tenantId,
        emailVerified: data.emailVerified ?? false,
        oauthProvider: data.oauthProvider,
        oauthProviderId: data.oauthProviderId,
      },
    });
    return this.toAuthUser(row);
  }
}
