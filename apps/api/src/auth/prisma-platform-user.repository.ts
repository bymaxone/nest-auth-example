/**
 * @file prisma-platform-user.repository.ts
 * @description Prisma-backed implementation of `IPlatformUserRepository` for platform admins.
 *
 * Analogous to `PrismaUserRepository` but scoped to the platform admin layer.
 * Platform admins operate above tenants — there is no `tenantId` on any query here.
 *
 * Critical invariants:
 * - `passwordHash`, `mfaSecret`, and `mfaRecoveryCodes` are stored and returned
 *   verbatim — the library owns hashing/encryption; this class never transforms them.
 * - Platform users are never mixed with tenant users — different Prisma models,
 *   different JWT payloads, different guards.
 *
 * Covers FCM row #22 (platform admin backing repository).
 *
 * @layer auth
 * @see docs/guidelines/prisma-guidelines.md
 * @see docs/guidelines/nest-auth-guidelines.md
 */

import { Injectable } from '@nestjs/common';
import type {
  AuthPlatformUser,
  IPlatformUserRepository,
  UpdatePlatformMfaData,
} from '@bymax-one/nest-auth';
import { UserStatus, type PlatformUser } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Prisma-backed repository for the platform admin auth context.
 *
 * Injected via `BYMAX_AUTH_PLATFORM_USER_REPOSITORY` token in Phase 7's `AuthModule`.
 * No `tenantId` filtering — platform users are not tenant-scoped.
 *
 * @public
 */
@Injectable()
export class PrismaPlatformUserRepository implements IPlatformUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Maps a Prisma `PlatformUser` row to the `AuthPlatformUser` shape.
   *
   * Optional fields (`mfaSecret`, `mfaRecoveryCodes`, `platformId`) are omitted
   * (not set to `undefined`) when absent, satisfying `exactOptionalPropertyTypes: true`.
   *
   * @param row - Raw Prisma `PlatformUser` row.
   * @returns An `AuthPlatformUser` without any Prisma-only internal fields.
   */
  private toAuthPlatformUser(row: PlatformUser): AuthPlatformUser {
    const base: AuthPlatformUser = {
      id: row.id,
      email: row.email,
      name: row.name,
      passwordHash: row.passwordHash,
      role: row.role,
      status: row.status,
      mfaEnabled: row.mfaEnabled,
      lastLoginAt: row.lastLoginAt,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    };

    // Conditionally assign optional fields — never set them to undefined.
    if (row.mfaSecret !== null) {
      base.mfaSecret = row.mfaSecret;
    }
    // Only assign mfaRecoveryCodes when MFA is enabled — see PrismaUserRepository
    // for the full rationale (Prisma default [] vs "all codes consumed" []).
    if (row.mfaEnabled) {
      base.mfaRecoveryCodes = row.mfaRecoveryCodes;
    }
    if (row.platformId !== null) {
      base.platformId = row.platformId;
    }

    return base;
  }

  /**
   * Finds a platform administrator by their unique internal identifier.
   *
   * @param id - The platform administrator's unique identifier.
   * @returns The matching `AuthPlatformUser`, or null if not found.
   */
  async findById(id: string): Promise<AuthPlatformUser | null> {
    const row = await this.prisma.platformUser.findUnique({ where: { id } });
    return row ? this.toAuthPlatformUser(row) : null;
  }

  /**
   * Finds a platform administrator by their email address.
   *
   * Uses the unique index on `email`. Email comparison is case-insensitive via
   * lower-case normalisation on writes.
   *
   * @param email - The platform administrator's email address.
   * @returns The matching `AuthPlatformUser`, or null if not found.
   */
  async findByEmail(email: string): Promise<AuthPlatformUser | null> {
    const row = await this.prisma.platformUser.findUnique({
      where: { email: email.toLowerCase() },
    });
    return row ? this.toAuthPlatformUser(row) : null;
  }

  /**
   * Records the current time as the administrator's last successful login timestamp.
   *
   * @param id - The platform administrator's unique identifier.
   */
  async updateLastLogin(id: string): Promise<void> {
    await this.prisma.platformUser.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  /**
   * Updates the platform administrator's TOTP MFA configuration.
   *
   * Writes `mfaEnabled`, `mfaSecret`, and `mfaRecoveryCodes` exactly as provided —
   * the library has already encrypted the secret and hashed the recovery codes.
   * Passing `null` clears the MFA fields (MFA disabled flow).
   *
   * @param id - The platform administrator's unique identifier.
   * @param data - New MFA state from the library.
   */
  async updateMfa(id: string, data: UpdatePlatformMfaData): Promise<void> {
    await this.prisma.platformUser.update({
      where: { id },
      data: {
        mfaEnabled: data.mfaEnabled,
        mfaSecret: data.mfaSecret,
        mfaRecoveryCodes: data.mfaRecoveryCodes ?? [],
      },
    });
  }

  /**
   * Replaces the platform administrator's stored password hash.
   *
   * The `passwordHash` is already produced by the library's `PasswordService` —
   * never call bcrypt/scrypt here.
   *
   * @param id - The platform administrator's unique identifier.
   * @param passwordHash - New hash from `PasswordService`. Never plaintext.
   */
  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.prisma.platformUser.update({ where: { id }, data: { passwordHash } });
  }

  /**
   * Updates the platform administrator's account lifecycle status.
   *
   * @param id - The platform administrator's unique identifier.
   * @param status - New status string (e.g. 'ACTIVE', 'SUSPENDED').
   */
  async updateStatus(id: string, status: string): Promise<void> {
    const resolvedStatus = Object.values(UserStatus).find((s) => s === status);
    if (resolvedStatus === undefined) {
      throw new Error(`Unknown UserStatus: '${status}' — library/schema mismatch`);
    }
    await this.prisma.platformUser.update({ where: { id }, data: { status: resolvedStatus } });
  }
}
