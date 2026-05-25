/**
 * @file account.service.ts
 * @description Business logic for the authenticated user's own account management.
 *
 * Implements `POST /api/account/change-password` by verifying the current
 * password against the stored scrypt hash, then writing the new hash.
 *
 * **Scrypt parameters** — the library (`@bymax-one/nest-auth`) does not export
 * `PasswordService`. This service replicates the wire format and default cost
 * parameters documented in `PasswordService`:
 *   - Format: `scrypt:{salt_hex}:{derived_hex}`
 *   - N=32768, r=8, p=1, keyLen=64 bytes, saltLen=16 bytes
 *   - maxmem=64 MiB (matches library default calculation for those params)
 *
 * These values must stay in sync with `auth.config.ts`. Because `auth.config.ts`
 * does not override `password.*` options, the library uses its built-in defaults,
 * which are the constants defined here.
 *
 * @layer account
 * @see docs/guidelines/nestjs-guidelines.md
 * @see docs/guidelines/security-privacy-guidelines.md
 */

import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import type { ChangePasswordDto } from './dto/change-password.dto.js';

// promisify picks the 3-arg overload; cast to include the options parameter.
const scryptAsync = promisify(nodeScrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Scrypt cost parameters — must match the library's PasswordService defaults. */
const SCRYPT_PARAMS = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const SCRYPT_KEY_LEN = 64;
const SALT_BYTES = 16;

/**
 * Verifies `plain` against a hash in `scrypt:{salt_hex}:{derived_hex}` format.
 *
 * Returns `false` for any malformed input rather than throwing, matching the
 * library's timing-safe behaviour.
 *
 * @param plain - Plaintext password.
 * @param hash  - Stored scrypt hash string.
 */
async function verifyScrypt(plain: string, hash: string): Promise<boolean> {
  const parts = hash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  const saltHex = parts[1];
  const derivedHex = parts[2];
  if (!saltHex || !derivedHex) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const stored = Buffer.from(derivedHex, 'hex');
  if (stored.length !== SCRYPT_KEY_LEN) return false;

  const candidate = await scryptAsync(plain, salt, SCRYPT_KEY_LEN, SCRYPT_PARAMS);
  return timingSafeEqual(candidate, stored);
}

/**
 * Hashes `plain` and returns the `scrypt:{salt_hex}:{derived_hex}` string.
 *
 * @param plain - Plaintext password.
 */
async function hashScrypt(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(plain, salt, SCRYPT_KEY_LEN, SCRYPT_PARAMS);
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

/**
 * One workspace the current user can sign into — a tenant where their email has
 * an active `User` row. Returned by {@link AccountService.listWorkspaces}.
 *
 * @public
 */
export interface WorkspaceInfo {
  /** Tenant CUID — used as the `X-Tenant-Id` header value. */
  readonly tenantId: string;
  /** URL-safe tenant slug — used for the `?tenantId=` login query param. */
  readonly tenantSlug: string;
  /** Human-readable tenant name — what the user sees in the switcher dropdown. */
  readonly tenantName: string;
  /** Role of the user in this tenant — purely informational for the UI. */
  readonly role: string;
  /** True when this workspace matches the current JWT's tenant context. */
  readonly isCurrent: boolean;
}

/**
 * Handles the authenticated user's own account operations.
 *
 * @public
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lists every active workspace (tenant) the current user's email has access
   * to. Each match is a separate `User` row (the library's one-JWT-per-tenant
   * model) sharing the same email — the typical multi-workspace SaaS pattern.
   *
   * The email is read from the user's own row (looked up by `userId` +
   * `currentTenantId`) — the JWT payload itself does not carry the email.
   *
   * Only `ACTIVE` accounts are returned; suspended or pending users in another
   * tenant must not surface as a destination the caller could switch to.
   *
   * The endpoint is JWT-protected, so no enumeration vector is created — the
   * caller already proved ownership of the email at login time.
   *
   * @param userId          - Authenticated user's ID (from JWT `sub`).
   * @param currentTenantId - Tenant CUID from the validated JWT (marks the active workspace).
   * @returns Sorted list of `WorkspaceInfo` rows (current first, then alphabetical).
   */
  async listWorkspaces(userId: string, currentTenantId: string): Promise<WorkspaceInfo[]> {
    // Resolve the caller's email from their own row — the JWT does not carry it.
    const me = await this.prisma.user.findUnique({
      where: { id: userId, tenantId: currentTenantId },
      select: { email: true },
    });
    if (me === null) return [];

    const rows = await this.prisma.user.findMany({
      where: { email: me.email, status: UserStatus.ACTIVE },
      select: {
        tenantId: true,
        role: true,
        tenant: { select: { id: true, slug: true, name: true } },
      },
    });

    const workspaces: WorkspaceInfo[] = rows.map((row) => ({
      tenantId: row.tenant.id,
      tenantSlug: row.tenant.slug,
      tenantName: row.tenant.name,
      role: row.role,
      isCurrent: row.tenantId === currentTenantId,
    }));

    // Stable ordering: current workspace first, then alphabetical by name.
    workspaces.sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      return a.tenantName.localeCompare(b.tenantName);
    });

    return workspaces;
  }

  /**
   * Verifies `currentPassword` against the stored hash, then replaces it with
   * a hash of `newPassword`.
   *
   * Fails with `BadRequestException` for OAuth-only accounts (no `passwordHash`).
   * Fails with `UnauthorizedException` when `currentPassword` does not match.
   *
   * Both lookup and update are scoped by `(id, tenantId)` to enforce tenant
   * isolation — a user in another tenant cannot be targeted even if the ID is
   * guessed.
   *
   * @param userId   - Authenticated user's ID (from JWT).
   * @param tenantId - Authenticated user's tenant ID (from JWT).
   * @param dto      - Validated `currentPassword` + `newPassword`.
   * @throws `BadRequestException`  when the account has no password (OAuth-only).
   * @throws `UnauthorizedException` when `currentPassword` is wrong.
   */
  async changePassword(userId: string, tenantId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, tenantId },
      select: { id: true, passwordHash: true },
    });

    if (user === null || user.passwordHash === null) {
      throw new BadRequestException(
        'Password change is not available for accounts without a local password.',
      );
    }

    const matches = await verifyScrypt(dto.currentPassword, user.passwordHash);
    if (!matches) {
      this.logger.warn({ msg: 'changePassword: wrong current password', userId });
      throw new UnauthorizedException('Current password is incorrect.');
    }

    const newHash = await hashScrypt(dto.newPassword);
    await this.prisma.user.update({
      where: { id: userId, tenantId },
      data: { passwordHash: newHash },
    });

    this.logger.log({ msg: 'changePassword: password updated', userId });
  }
}
