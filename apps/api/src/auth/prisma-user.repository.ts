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
 * @layer auth
 * @see docs/guidelines/prisma-guidelines.md
 * @see docs/guidelines/nest-auth-guidelines.md
 */

import { Injectable } from '@nestjs/common';
import type {
  AuthUser,
  CreateUserData,
  CreateWithOAuthData,
  FindUserByEmailParams,
  FindUserByOAuthIdParams,
  IUserRepository,
  LinkOAuthParams,
  TenantScopedUserRef,
  UpdateEmailParams,
  UpdateEmailVerifiedParams,
  UpdateMfaParams,
  UpdatePasswordParams,
  UpdateStatusParams,
} from '@bymax-one/nest-auth';
import { AUTH_ERROR_CODES, AuthException } from '@bymax-one/nest-auth';
import { Role, UserStatus, type User } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import { BLOCKED_USER_STATUSES } from './auth.constants.js';

/**
 * Prisma-backed user repository for the tenant (dashboard) auth context.
 *
 * Injected via `BYMAX_AUTH_USER_REPOSITORY` token in `AuthModule`.
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
   * Finds a user by their internal unique identifier, scoped to a tenant.
   *
   * The tenant is part of the WHERE clause (not a post-filter), so cross-tenant
   * rows are never fetched and deserialized into heap memory at all. The library
   * requires the pair — ids may not be unique across tenants in a derived schema.
   *
   * @param params - `{ id, tenantId }` — the account reference on the dashboard plane.
   * @returns The matching `AuthUser`, or null if not found or tenant mismatch.
   */
  async findById({ id, tenantId }: TenantScopedUserRef): Promise<AuthUser | null> {
    const row = await this.prisma.user.findFirst({ where: { id, tenantId } });
    return row ? this.toAuthUser(row) : null;
  }

  /**
   * Finds a user by email within a specific tenant.
   *
   * Uses the compound unique index `(tenantId, email)` for an O(1) lookup.
   * The library normalises email to lower-case before calling this method.
   *
   * @param params - `{ email, tenantId }` — address plus tenant scope.
   * @returns The matching `AuthUser`, or null if not found.
   */
  async findByEmail({ email, tenantId }: FindUserByEmailParams): Promise<AuthUser | null> {
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
    const role =
      data.role === undefined ? Role.MEMBER : Object.values(Role).find((r) => r === data.role);
    if (role === undefined) {
      throw new Error(`Unknown Role: '${data.role}' — library/schema mismatch`);
    }
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
   * never call bcrypt/scrypt inside this method. `updateMany` scopes the write
   * by `(id, tenantId)` so it can never land on another tenant's row — the
   * library's port contract for every tenant-scoped write.
   *
   * @param params - `{ id, tenantId, passwordHash }`. Hash only — never plaintext.
   */
  async updatePassword({ id, tenantId, passwordHash }: UpdatePasswordParams): Promise<void> {
    await this.prisma.user.updateMany({ where: { id, tenantId }, data: { passwordHash } });
  }

  /**
   * Updates the user's TOTP MFA configuration.
   *
   * Writes `mfaEnabled`, `mfaSecret`, and `mfaRecoveryCodes` exactly as provided —
   * the library has already encrypted the secret and hashed the recovery codes.
   * Passing `null` clears the MFA fields (MFA disabled flow).
   *
   * @param params - `{ id, tenantId, data }` — new MFA state from the library.
   */
  async updateMfa({ id, tenantId, data }: UpdateMfaParams): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id, tenantId },
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
   * @param params - `{ id, tenantId }` — the account reference.
   */
  async updateLastLogin({ id, tenantId }: TenantScopedUserRef): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id, tenantId },
      data: { lastLoginAt: new Date() },
    });
  }

  /**
   * Updates the user's account lifecycle status.
   *
   * @param params - `{ id, tenantId, status }` — new status string (e.g. 'ACTIVE').
   */
  async updateStatus({ id, tenantId, status }: UpdateStatusParams): Promise<void> {
    const resolvedStatus = Object.values(UserStatus).find((s) => s === status);
    if (resolvedStatus === undefined) {
      throw new Error(`Unknown UserStatus: '${status}' — library/schema mismatch`);
    }
    await this.prisma.user.updateMany({
      where: { id, tenantId },
      data: { status: resolvedStatus },
    });
  }

  /**
   * Marks the user's email address as verified or unverified.
   *
   * @param params - `{ id, tenantId, verified }`.
   */
  async updateEmailVerified({ id, tenantId, verified }: UpdateEmailVerifiedParams): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id, tenantId },
      data: { emailVerified: verified },
    });
  }

  /**
   * Moves the user's account to a new (already normalised) email address.
   *
   * Called by the library's email-change flow after the new address has been
   * verified. The compound unique index `(tenantId, email)` makes a duplicate
   * address inside the tenant fail at the database level.
   *
   * @param params - `{ id, tenantId, email }` — the new address.
   */
  async updateEmail({ id, tenantId, email }: UpdateEmailParams): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id, tenantId },
      data: { email: email.toLowerCase() },
    });
  }

  /**
   * Finds a user by OAuth provider and external provider ID, scoped to a tenant.
   *
   * Uses the schema unique index `(oauthProvider, oauthProviderId)` together
   * with `tenantId` to prevent cross-tenant collisions. `findFirst` is used instead
   * of `findUnique` because `tenantId` is not part of the unique index — the composite
   * named key does not include it, so Prisma cannot use `findUnique` here.
   *
   * @param params - `{ provider, providerId, tenantId }`.
   * @returns The matching `AuthUser`, or null if not found.
   */
  async findByOAuthId({
    provider,
    providerId,
    tenantId,
  }: FindUserByOAuthIdParams): Promise<AuthUser | null> {
    const row = await this.prisma.user.findFirst({
      where: { oauthProvider: provider, oauthProviderId: providerId, tenantId },
    });
    return row ? this.toAuthUser(row) : null;
  }

  /**
   * Re-writes the OAuth identity on an account that is already linked to it.
   *
   * Reached only from the library's `link` branch, which runs when
   * `findByOAuthId` has already matched a row by `(provider, providerId)` — so
   * this re-authenticates an established link rather than creating one. Since
   * lib v1.4.x there is no email-based linking: an OAuth profile whose address
   * already belongs to an account in the tenant is refused with
   * `auth.oauth_email_mismatch` before any write happens, so a caller must
   * never rely on this method to attach a provider to a password account.
   * Scoped by `(id, tenantId)` like every other write on this port.
   *
   * @param params - `{ id, tenantId, provider, providerId }`.
   */
  async linkOAuth({ id, tenantId, provider, providerId }: LinkOAuthParams): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id, tenantId },
      data: { oauthProvider: provider, oauthProviderId: providerId },
    });
  }

  /**
   * Creates a user originating from an OAuth provider.
   *
   * The library calls this only after its own `findByEmail` came back empty, so
   * in the OAuth flow the address is new to the tenant. An OAuth profile whose
   * address already belongs to an account is refused upstream with
   * `auth.oauth_email_mismatch` — a stranger who controls the provider identity
   * for someone else's address must not inherit their account.
   *
   * Implemented as an upsert on `(tenantId, email)` rather than a create:
   * - **Insert branch** — the normal path. A fresh row with no password hash
   *   and the OAuth identity pre-populated.
   * - **Update branch** — reached only in the race where a row for that address
   *   is committed between the library's check and this write. It touches the
   *   OAuth identity and `emailVerified` alone, leaving name, role, and status
   *   as they were, so a concurrent insert cannot be escalated through this
   *   path. A plain `create` would answer that race with a unique-constraint
   *   crash instead.
   *
   * Blocked-status guard (two-phase):
   * 1. Pre-upsert `findUnique` — rejects blocked existing users before the upsert
   *    runs, preventing the `update` branch from mutating `emailVerified` on a
   *    blocked row as a side effect of a rejected authentication attempt.
   * 2. Post-upsert check — catches the narrow TOCTOU window where an account is
   *    blocked between the pre-check and the upsert commit.
   *
   * @param data - OAuth creation payload.
   * @returns The created or updated `AuthUser`.
   */
  async createWithOAuth(data: CreateWithOAuthData): Promise<AuthUser> {
    const role =
      data.role === undefined ? Role.MEMBER : Object.values(Role).find((r) => r === data.role);
    if (role === undefined) {
      throw new Error(`Unknown Role: '${data.role}' — library/schema mismatch`);
    }
    const status = Object.values(UserStatus).find((s) => s === data.status) ?? UserStatus.ACTIVE;
    const email = data.email.toLowerCase();

    // Pre-upsert blocked-status check: reject a blocked existing row before any
    // write occurs. This port is the boundary, so it does not assume the caller
    // screened the address first — reaching the update branch on a blocked
    // account would commit `emailVerified = true` on it, and the post-upsert
    // check below only withholds tokens, it does not undo that write. A blocked
    // user could otherwise bank a verified email for whenever an admin
    // re-activates them.
    const existingForStatusCheck = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: data.tenantId, email } },
      select: { status: true },
    });
    if (
      existingForStatusCheck !== null &&
      BLOCKED_USER_STATUSES.includes(existingForStatusCheck.status)
    ) {
      throw new AuthException(AUTH_ERROR_CODES.OAUTH_FAILED);
    }

    const row = await this.prisma.user.upsert({
      where: { tenantId_email: { tenantId: data.tenantId, email } },
      // Only reachable on the concurrent-insert race described above. Update
      // the OAuth identity fields alone — never name, role, or status.
      update: {
        oauthProvider: data.oauthProvider,
        oauthProviderId: data.oauthProviderId,
        emailVerified: data.emailVerified ?? true,
      },
      create: {
        email,
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

    // Post-upsert check catches the TOCTOU window where an account is blocked
    // between the pre-check query and the upsert commit. The upsert returns
    // the row as it exists in the DB at commit time, so this reflects the
    // actual current status. The library's OAuthService does not check user
    // status before issuing tokens, so this guard is the sole protection for
    // the OAuth path.
    if (BLOCKED_USER_STATUSES.includes(row.status)) {
      throw new AuthException(AUTH_ERROR_CODES.OAUTH_FAILED);
    }

    return this.toAuthUser(row);
  }
}
