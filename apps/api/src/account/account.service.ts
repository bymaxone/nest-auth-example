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
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@prisma/client';

import type { Env } from '../config/env.schema.js';
import { parseRequiredTenantSlugs } from '../auth/tenant-mfa-policy.guard.js';
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
 * MFA status snapshot for the current user, returned by {@link AccountService.getMfaStatus}.
 *
 * Drives the security page UI: the recovery-code counter, the low-codes
 * warning, and the "MFA required for this workspace" banner backed by the
 * `TenantMfaPolicyGuard`. The fields are deliberately framed for UI
 * consumption — exposing internal storage details (e.g., the hash array
 * itself) would leak structural data without giving the UI anything
 * actionable.
 *
 * @public
 */
export interface MfaStatusInfo {
  /** Whether the user has completed MFA enrollment (matches `user.mfaEnabled`). */
  readonly enabled: boolean;
  /**
   * Count of unused recovery codes remaining on the account. Each successful
   * recovery-code login consumes one entry from `user.mfaRecoveryCodes`.
   * Always `0` when MFA is not enabled.
   */
  readonly recoveryCodesRemaining: number;
  /**
   * Initial count generated at enrollment — used by the UI to render the
   * "X of Y remaining" indicator and to decide when to surface the
   * regenerate CTA prominently. Mirrors the lib's `mfa.recoveryCodeCount`
   * option from `auth.config.ts` (default 8 in this example).
   */
  readonly recoveryCodesTotal: number;
  /**
   * Whether the user's tenant requires MFA enrollment. Mirrors the
   * `TenantMfaPolicyGuard`'s in-memory policy resolved from the
   * `MFA_REQUIRED_TENANT_SLUGS` env var. When `true` and `enabled` is
   * `false`, the UI must redirect protected pages to `/dashboard/security`
   * because every business endpoint will 403 with `MFA_SETUP_REQUIRED`.
   */
  readonly required: boolean;
}

/**
 * Handles the authenticated user's own account operations.
 *
 * @public
 */
/**
 * Initial recovery-code count generated by the lib at MFA enrollment. Must
 * mirror the `mfa.recoveryCodeCount` option configured in `auth.config.ts`;
 * the lib defaults this to 8 (matching `auth.config.ts → mfa.recoveryCodeCount`
 * in this example), so the constant is duplicated here for the
 * `MfaStatusInfo.recoveryCodesTotal` field. The two stay in sync because the
 * value never changes once enrollment completes (recovery codes are
 * generated once, hashed, and stored).
 */
const RECOVERY_CODES_TOTAL = 8;

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);
  /**
   * Tenant CUIDs that require MFA enrolment. Resolved lazily on first use
   * from the slug list in `MFA_REQUIRED_TENANT_SLUGS` so the boot sequence
   * does not duplicate the `TenantMfaPolicyGuard`'s init query (and so an
   * accidentally-empty list never silently disables enforcement until the
   * next restart).
   */
  private requiredTenantIds: ReadonlySet<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Resolves and memoizes the set of MFA-required tenant CUIDs.
   *
   * Mirrors `TenantMfaPolicyGuard.onModuleInit` so the security page's
   * `required` flag stays in sync with the guard's enforcement set even
   * when the two are computed in different modules.
   */
  private async getRequiredTenantIds(): Promise<ReadonlySet<string>> {
    if (this.requiredTenantIds !== null) {
      return this.requiredTenantIds;
    }
    const raw = this.config.get<string>('MFA_REQUIRED_TENANT_SLUGS') ?? '';
    const slugs = parseRequiredTenantSlugs(raw);
    if (slugs.length === 0) {
      this.requiredTenantIds = new Set();
      return this.requiredTenantIds;
    }
    const rows = await this.prisma.tenant.findMany({
      where: { slug: { in: slugs } },
      select: { id: true },
    });
    this.requiredTenantIds = new Set(rows.map((row) => row.id));
    return this.requiredTenantIds;
  }

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
   * Validates that the caller has an ACTIVE account in the destination
   * tenant (same email as their current row) and returns the target
   * `User.id` so the controller can mint a session for it via the
   * lib's password-less token path.
   *
   * **The ownership rule enforced here is the email match.** A user in
   * tenant A can only switch to tenant B if and only if their email also
   * has an ACTIVE row in tenant B. This is the same model Slack /
   * Linear use: the workspaces are linked through the email cluster,
   * but each is a distinct account with its own password / MFA / role.
   *
   * Refuses self-switch (same tenant in and out) so the caller cannot
   * accidentally renew their own session via this path — `/auth/refresh`
   * is the only legitimate way to rotate tokens for the current tenant.
   *
   * @param currentUserId   - Authenticated user's ID (from JWT `sub`).
   * @param currentTenantId - Authenticated user's tenant ID (from JWT).
   * @param targetTenantId  - Destination tenant CUID from the DTO.
   * @returns `targetUserId` + `targetTenantSlug` for the controller and
   *   audit log.
   * @throws `BadRequestException`   when target == current.
   * @throws `UnauthorizedException` when the caller's own row is missing.
   * @throws `NotFoundException`     when the email has no row in the target.
   * @throws `ForbiddenException`    when the target row is not ACTIVE.
   */
  async findSwitchTarget(
    currentUserId: string,
    currentTenantId: string,
    targetTenantId: string,
  ): Promise<{ targetUserId: string; targetTenantSlug: string }> {
    if (currentTenantId === targetTenantId) {
      throw new BadRequestException('You are already signed in to this workspace.');
    }

    // Resolve caller's email — required to look up the sibling row.
    const me = await this.prisma.user.findUnique({
      where: { id: currentUserId, tenantId: currentTenantId },
      select: { email: true },
    });
    if (me === null) {
      throw new UnauthorizedException('Your account could not be resolved.');
    }

    // Look up the target row by (tenantId, email). The lib's seed + every
    // multi-workspace setup pivots on this composite unique key — same
    // email, distinct row per tenant.
    const target = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: targetTenantId, email: me.email } },
      select: { id: true, status: true, tenant: { select: { slug: true } } },
    });
    if (target === null) {
      // 404 — the caller does not have an account in this workspace. We
      // surface this distinctly from 403 because the UI dropdown should
      // never offer a workspace the caller cannot enter; a 404 here
      // signals a stale workspaces list (e.g. account removed in the
      // destination tenant after the page loaded).
      throw new NotFoundException('You do not have access to this workspace.');
    }
    if (target.status !== UserStatus.ACTIVE) {
      // 403 — explicit "account exists but is blocked here" so the UI can
      // surface a meaningful message ("Your account in <workspace> is
      // suspended") rather than the generic 404.
      throw new ForbiddenException('Your account in the target workspace is not active.');
    }

    this.logger.log({
      msg: 'switchWorkspace: validated switch target',
      currentUserId,
      currentTenantId,
      targetUserId: target.id,
      targetTenantId,
    });

    return { targetUserId: target.id, targetTenantSlug: target.tenant.slug };
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

  /**
   * Returns the MFA status snapshot for the current user — used by the
   * security page UI to render the recovery-code counter and to decide
   * which card (setup / disable) to show.
   *
   * The recovery-code count is derived from the length of
   * `user.mfaRecoveryCodes` (each entry is a scrypt hash of an unused code;
   * consumed codes are removed by the lib on successful recovery login).
   * No plaintext data ever leaves this method.
   *
   * Scoped by `(id, tenantId)` for tenant isolation — a user from another
   * tenant cannot probe this surface even with a guessed user ID.
   *
   * @param userId   - Authenticated user's ID (from JWT `sub`).
   * @param tenantId - Authenticated user's tenant ID (from JWT).
   * @returns Snapshot suitable for direct UI consumption.
   * @throws `UnauthorizedException` when the (id, tenantId) pair has no row,
   *   which can only happen if the JWT outlives a deleted user.
   */
  async getMfaStatus(userId: string, tenantId: string): Promise<MfaStatusInfo> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, tenantId },
      select: { mfaEnabled: true, mfaRecoveryCodes: true },
    });

    if (user === null) {
      throw new UnauthorizedException('User account not found.');
    }

    const requiredTenantIds = await this.getRequiredTenantIds();

    return {
      enabled: user.mfaEnabled,
      recoveryCodesRemaining: user.mfaEnabled ? user.mfaRecoveryCodes.length : 0,
      recoveryCodesTotal: RECOVERY_CODES_TOTAL,
      required: requiredTenantIds.has(tenantId),
    };
  }
}
