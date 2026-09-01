/**
 * @file account.service.spec.ts
 * @description Unit tests for `AccountService`.
 *
 * Verifies:
 * - `changePassword`: user-not-found (null) → BadRequestException.
 * - `changePassword`: user with null passwordHash (OAuth-only) → BadRequestException.
 * - `changePassword`: wrong current password → UnauthorizedException.
 * - `changePassword`: correct current password → updates hash and resolves to void.
 *
 * The scrypt helper functions (`verifyScrypt`, `hashScrypt`) are module-scope
 * closures not exported by the service. They are exercised through the public
 * `changePassword` method. The success path uses real scrypt operations via
 * `node:crypto` to verify end-to-end correctness without mocking the crypto layer.
 *
 * The wrong-password path creates a valid hash for a different password, ensuring
 * `timingSafeEqual` fires the mismatch path without any mocking.
 *
 * @layer test
 * @see apps/api/src/account/account.service.ts
 */

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { jest } from '@jest/globals';
import { randomBytes, scrypt as nodeScrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service.js';
import { AccountService } from './account.service.js';
import { PasswordResetService } from '@bymax-one/nest-auth';
import type { ChangePasswordDto } from '@bymax-one/nest-auth';

// ─── Scrypt helpers (mirrors service constants) ───────────────────────────────

/** Must match the service constants to produce compatible hashes. */
const SCRYPT_PARAMS = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const SCRYPT_KEY_LEN = 64;
const SALT_BYTES = 16;

const scryptAsync = promisify(nodeScrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Produces a `scrypt:{salt_hex}:{derived_hex}` hash matching the service format.
 *
 * @param plain - Plaintext password to hash.
 */
async function makeHash(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(plain, salt, SCRYPT_KEY_LEN, SCRYPT_PARAMS);
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

/** Row shape returned by `prisma.user.findMany` for `listWorkspaces` tests. */
interface WorkspaceRow {
  tenantId: string;
  role: string;
  tenant: { id: string; slug: string; name: string };
}

/**
 * Union of every `select` projection the service uses through
 * `prisma.user.findUnique`. Each test mocks the call to return whichever
 * shape its target method expects.
 */
type UserFindUniqueReturn =
  | { id: string; passwordHash: string | null }
  | { email: string }
  | { mfaEnabled: boolean; mfaRecoveryCodes: string[] }
  // Shape returned by `findSwitchTarget`'s target-row lookup — `select` is
  // `{ id, status, tenant: { select: { slug } } }`. Declared as a discriminant
  // arm so the test mocks compile without `as unknown as ...` casts.
  | { id: string; status: string; tenant: { slug: string } }
  | null;

describe('AccountService', () => {
  let service: AccountService;
  let userFindUnique: jest.Mock<() => Promise<UserFindUniqueReturn>>;
  let userFindMany: jest.Mock<() => Promise<WorkspaceRow[]>>;
  let libChangePassword: jest.Mock<() => Promise<void>>;
  let userUpdate: jest.Mock<() => Promise<unknown>>;
  let tenantFindMany: jest.Mock<() => Promise<Array<{ id: string }>>>;
  let configGet: jest.Mock<(key: string) => string | undefined>;

  beforeEach(async () => {
    userFindUnique = jest.fn();
    userFindMany = jest.fn();
    userUpdate = jest.fn<() => Promise<unknown>>();
    libChangePassword = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    tenantFindMany = jest.fn();
    configGet = jest.fn<(key: string) => string | undefined>();
    // Default: no tenant requires MFA. Individual tests override per case.
    configGet.mockReturnValue('');
    // Default: tenant lookup returns no matches; tests that need a match
    // override with `tenantFindMany.mockResolvedValueOnce(...)`.
    tenantFindMany.mockResolvedValue([]);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique: userFindUnique, findMany: userFindMany, update: userUpdate },
            tenant: { findMany: tenantFindMany },
          },
        },
        {
          provide: ConfigService,
          useValue: { get: configGet },
        },
        // The library owns the credential rotation; this service only calls it.
        {
          provide: PasswordResetService,
          useValue: { changePassword: libChangePassword },
        },
      ],
    }).compile();

    service = moduleRef.get(AccountService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ─── changePassword ────────────────────────────────────────────────────────

  describe('changePassword', () => {
    it('delegates the whole operation to the library password service', async () => {
      /*
       * Scenario: hash format, minimum length, breach checking and the session
       * consequences of a rotation all belong to the library. This route is a
       * custom controller over that service, not a second implementation —
       * re-implementing it here is exactly what left the endpoint rejecting
       * every valid password once the library moved to the PHC hash format.
       * Protects: the delegation, and the argument order the library reads
       * identity from.
       */
      const dto: ChangePasswordDto = {
        currentPassword: 'CurrentPassw0rd!',
        newPassword: 'BrandNewPassw0rd!!',
      };

      await service.changePassword('user-1', 'tenant-acme', dto);

      expect(libChangePassword).toHaveBeenCalledWith('user-1', 'tenant-acme', dto);
    });

    it('never writes the password itself through Prisma', async () => {
      /*
       * Scenario: the previous implementation hashed and wrote the credential
       * here. Nothing in this service may touch `passwordHash` any more — a
       * stray write would reintroduce the app-owned hash format that the
       * library upgrade turned into a route rejecting every password.
       * Protects: the absence of a local persistence path for credentials.
       */
      await service.changePassword('user-1', 'tenant-acme', {
        currentPassword: 'CurrentPassw0rd!',
        newPassword: 'BrandNewPassw0rd!!',
      });

      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('lets a library rejection bubble unchanged', async () => {
      /*
       * Scenario: the library answers a wrong current password, an OAuth-only
       * account, or a breached new password with its own AuthException, which
       * the exception filter maps to the documented `auth.*` code. Wrapping it
       * here would replace that contract with a generic 500.
       * Protects: library-thrown exceptions are not caught or re-wrapped.
       */
      const libError = new Error('auth.invalid_credentials');
      libChangePassword.mockRejectedValueOnce(libError);

      await expect(
        service.changePassword('user-1', 'tenant-acme', {
          currentPassword: 'WrongPassw0rd!',
          newPassword: 'BrandNewPassw0rd!!',
        }),
      ).rejects.toBe(libError);
    });
  });

  // ─── listWorkspaces ────────────────────────────────────────────────────────

  describe('listWorkspaces', () => {
    it('returns an empty array when the caller cannot be resolved', async () => {
      // If findUnique returns null (user deleted between JWT issue and call),
      // the service must return an empty list rather than throw — the UI then
      // hides the switcher gracefully.
      userFindUnique.mockResolvedValue(null);

      const result = await service.listWorkspaces('ghost-user', 'tenant-acme');

      expect(result).toEqual([]);
      expect(userFindMany).not.toHaveBeenCalled();
    });

    it('returns a single entry marked as current when the email exists in only one tenant', async () => {
      // Default seed case: a fresh user belongs to a single tenant. The list has
      // one row, isCurrent=true, so the dropdown shows the active workspace badge.
      userFindUnique.mockResolvedValue({ email: 'solo@example.dev' });
      userFindMany.mockResolvedValue([
        {
          tenantId: 'tenant-acme',
          role: 'ADMIN',
          tenant: { id: 'tenant-acme', slug: 'acme', name: 'Acme Corp' },
        },
      ]);

      const result = await service.listWorkspaces('user-1', 'tenant-acme');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        tenantId: 'tenant-acme',
        tenantSlug: 'acme',
        tenantName: 'Acme Corp',
        role: 'ADMIN',
        isCurrent: true,
      });
    });

    it('returns multiple entries when the email exists in several tenants, current first then alphabetical', async () => {
      // Multi-workspace user: same email belongs to acme and globex. The current
      // workspace must be first, the rest sorted alphabetically by tenant name.
      userFindUnique.mockResolvedValue({ email: 'admin@example.dev' });
      // Intentionally return rows in an order that does NOT match the expected
      // sort order so the test exercises the sort, not the input ordering.
      userFindMany.mockResolvedValue([
        {
          tenantId: 'tenant-globex',
          role: 'ADMIN',
          tenant: { id: 'tenant-globex', slug: 'globex', name: 'Globex Inc' },
        },
        {
          tenantId: 'tenant-acme',
          role: 'ADMIN',
          tenant: { id: 'tenant-acme', slug: 'acme', name: 'Acme Corp' },
        },
      ]);

      const result = await service.listWorkspaces('user-1', 'tenant-acme');

      // Current (acme) first regardless of input order.
      expect(result.map((w) => w.tenantSlug)).toEqual(['acme', 'globex']);
      expect(result[0]?.isCurrent).toBe(true);
      expect(result[1]?.isCurrent).toBe(false);
    });

    /**
     * Exercises the "current first" branch when the current row appears
     * FIRST in the DB input order. The earlier test put the non-current
     * row first, so V8's first compare(a=globex, b=acme) hit the
     * `a.isCurrent === false → 1` branch — the `-1` half of the ternary
     * was never executed. Inverting the input order forces V8 to call
     * compare(a=acme[current], b=globex[non-current]), which lands on the
     * `a.isCurrent === true → -1` branch and closes the coverage gap.
     */
    it('keeps the current workspace first when it appears first in the DB input order', async () => {
      userFindUnique.mockResolvedValue({ email: 'admin@example.dev' });
      userFindMany.mockResolvedValue([
        // Current row FIRST — opposite of the prior multi-tenant test.
        {
          tenantId: 'tenant-acme',
          role: 'ADMIN',
          tenant: { id: 'tenant-acme', slug: 'acme', name: 'Acme Corp' },
        },
        {
          tenantId: 'tenant-globex',
          role: 'ADMIN',
          tenant: { id: 'tenant-globex', slug: 'globex', name: 'Globex Inc' },
        },
      ]);

      const result = await service.listWorkspaces('user-1', 'tenant-acme');

      expect(result.map((w) => w.tenantSlug)).toEqual(['acme', 'globex']);
      expect(result[0]?.isCurrent).toBe(true);
    });

    /**
     * Exercises the alphabetical tie-break branch of the workspace sort.
     * The previous test pinned the "current first" branch by giving the
     * two workspaces different `isCurrent` values. This test passes a
     * `currentTenantId` that does NOT match any of the rows so both
     * workspaces collapse to `isCurrent: false` and the comparator falls
     * through to `a.tenantName.localeCompare(b.tenantName)`. Without this
     * scenario, the localeCompare line never executes and coverage drops.
     */
    it('sorts non-current workspaces alphabetically by tenant name', async () => {
      userFindUnique.mockResolvedValue({ email: 'admin@example.dev' });
      // Reverse-alphabetical input order so the sort has work to do.
      userFindMany.mockResolvedValue([
        {
          tenantId: 'tenant-globex',
          role: 'ADMIN',
          tenant: { id: 'tenant-globex', slug: 'globex', name: 'Globex Inc' },
        },
        {
          tenantId: 'tenant-acme',
          role: 'ADMIN',
          tenant: { id: 'tenant-acme', slug: 'acme', name: 'Acme Corp' },
        },
      ]);

      // `currentTenantId` does not match either workspace — both end up
      // `isCurrent: false`, forcing the localeCompare branch.
      const result = await service.listWorkspaces('user-1', 'tenant-nonexistent');

      expect(result.map((w) => w.tenantName)).toEqual(['Acme Corp', 'Globex Inc']);
      expect(result.every((w) => w.isCurrent === false)).toBe(true);
    });

    it('scopes the lookup by the email of the JWT-resolved user, only ACTIVE accounts', async () => {
      // Tenant isolation + status check happens via the findMany WHERE clause —
      // verify the service requests exactly the right shape so the DB query
      // never leaks inactive or unrelated rows.
      userFindUnique.mockResolvedValue({ email: 'admin@example.dev' });
      userFindMany.mockResolvedValue([]);

      await service.listWorkspaces('user-1', 'tenant-acme');

      expect(userFindMany).toHaveBeenCalledTimes(1);
      // Cast through unknown: the mock's recorded args have a runtime shape but
      // its TS signature is the no-arg `() => Promise<...>` declared above.
      const calls = userFindMany.mock.calls as unknown as Array<
        [{ where: { email: string; status: string } }]
      >;
      const args = calls[0]?.[0];
      expect(args).toBeDefined();
      expect(args?.where.email).toBe('admin@example.dev');
      // Status guard must request ACTIVE rows only.
      expect(String(args?.where.status)).toBe('ACTIVE');
    });
  });

  // ─── findSwitchTarget ──────────────────────────────────────────────────────

  describe('findSwitchTarget', () => {
    /*
     * Scenario: caller asks to switch into the tenant they are already
     * signed into. The service must throw `BadRequestException` before
     * touching the DB — otherwise the controller would mint a needless
     * new session and silently rotate cookies for the same identity.
     * Protects: self-switch refusal.
     */
    it('rejects self-switch with BadRequestException', async () => {
      await expect(
        service.findSwitchTarget('user-1', 'tenant-acme', 'tenant-acme'),
      ).rejects.toThrow(BadRequestException);
      expect(userFindUnique).not.toHaveBeenCalled();
    });

    /*
     * Scenario: caller's own User row is missing (deleted between JWT
     * issuance and this call). Without an email, the sibling lookup
     * cannot run — service must throw `UnauthorizedException` so the
     * caller's stale session is killed by the global error handler.
     * Protects: caller-not-found branch.
     */
    it('throws UnauthorizedException when the caller row cannot be resolved', async () => {
      userFindUnique.mockResolvedValueOnce(null);

      await expect(
        service.findSwitchTarget('ghost', 'tenant-acme', 'tenant-globex'),
      ).rejects.toThrow(UnauthorizedException);
    });

    /*
     * Scenario: caller has an email but no sibling row in the destination
     * tenant. The service must surface `NotFoundException` so the UI can
     * refresh the stale workspace list — a 403 here would mislead callers
     * into thinking they "have an account but cannot use it."
     * Protects: missing-target branch.
     */
    it('throws NotFoundException when the email has no row in the target tenant', async () => {
      // First call: caller's own row → returns email.
      // Second call: lookup in target tenant → no row.
      userFindUnique.mockResolvedValueOnce({ email: 'admin@example.dev' });
      userFindUnique.mockResolvedValueOnce(null);

      await expect(
        service.findSwitchTarget('user-1', 'tenant-acme', 'tenant-globex'),
      ).rejects.toThrow(NotFoundException);
    });

    /*
     * Scenario: caller has a sibling row in the destination tenant but it
     * is SUSPENDED / BANNED / INACTIVE. The service must throw
     * `ForbiddenException` distinct from the 404 above so the UI can
     * surface a meaningful message instead of silently dropping the
     * workspace from the dropdown.
     * Protects: status guard mirrors the password-login path.
     */
    it('throws ForbiddenException when the target row is not ACTIVE', async () => {
      userFindUnique.mockResolvedValueOnce({ email: 'admin@example.dev' });
      userFindUnique.mockResolvedValueOnce({
        id: 'user-target',
        status: 'SUSPENDED',
        tenant: { slug: 'globex' },
      });

      await expect(
        service.findSwitchTarget('user-1', 'tenant-acme', 'tenant-globex'),
      ).rejects.toThrow(ForbiddenException);
    });

    /*
     * Scenario: happy path — caller's email has an ACTIVE row in the
     * target tenant. Service returns `{ targetUserId, targetTenantSlug }`
     * so the controller can mint tokens via the lib and the audit log
     * can record the destination slug.
     * Protects: the canonical return shape.
     */
    it('returns the target userId + slug on a valid email match', async () => {
      userFindUnique.mockResolvedValueOnce({ email: 'admin@example.dev' });
      userFindUnique.mockResolvedValueOnce({
        id: 'user-target-globex',
        status: 'ACTIVE',
        tenant: { slug: 'globex' },
      });

      const result = await service.findSwitchTarget('user-1', 'tenant-acme', 'tenant-globex');

      expect(result).toEqual({
        targetUserId: 'user-target-globex',
        targetTenantSlug: 'globex',
      });
    });

    /*
     * Scenario: the target lookup must use the `(tenantId, email)`
     * composite unique key — the same key the lib uses to bind one User
     * row per (tenant, email) pair. A future refactor swapping it for
     * `(email)` alone would let the lookup pick a row from the WRONG
     * tenant. Pinning the WHERE shape catches that regression.
     * Protects: ownership rule queries against the intended unique key.
     */
    it('scopes the target lookup by (tenantId, email) composite key', async () => {
      userFindUnique.mockResolvedValueOnce({ email: 'admin@example.dev' });
      userFindUnique.mockResolvedValueOnce({
        id: 'user-target',
        status: 'ACTIVE',
        tenant: { slug: 'globex' },
      });

      await service.findSwitchTarget('user-1', 'tenant-acme', 'tenant-globex');

      const calls = userFindUnique.mock.calls as unknown as Array<
        [{ where: Record<string, unknown> }]
      >;
      // Two calls: caller lookup + target lookup.
      expect(calls).toHaveLength(2);
      const targetCallWhere = calls[1]?.[0].where as Record<string, unknown>;
      expect(targetCallWhere).toHaveProperty('tenantId_email');
      const composite = targetCallWhere['tenantId_email'] as Record<string, string>;
      expect(composite.tenantId).toBe('tenant-globex');
      expect(composite.email).toBe('admin@example.dev');
    });
  });

  // ─── getMfaStatus ──────────────────────────────────────────────────────────

  describe('getMfaStatus', () => {
    it('returns enabled=false and remaining=0 when MFA is not enrolled', async () => {
      /*
       * Scenario: a user without MFA enrolled hits the security page. The
       * service must return a snapshot where `recoveryCodesRemaining` is
       * forced to 0 — even if the DB row somehow had stale code hashes
       * left over from a previous enrollment, the UI must not surface
       * them as actionable. Protects the `user.mfaEnabled ? … : 0`
       * conditional.
       */
      userFindUnique.mockResolvedValue({ mfaEnabled: false, mfaRecoveryCodes: [] });

      const status = await service.getMfaStatus('user-1', 'tenant-acme');

      expect(status.enabled).toBe(false);
      expect(status.recoveryCodesRemaining).toBe(0);
      expect(status.recoveryCodesTotal).toBe(8);
    });

    it('returns remaining=length(mfaRecoveryCodes) when MFA is enabled', async () => {
      /*
       * Scenario: a user has MFA on and consumed 3 of 8 recovery codes.
       * Five hashed entries remain in the DB. The service must expose
       * the array length as `recoveryCodesRemaining` so the UI can render
       * the "5 of 8 remaining" indicator. Protects the truthy branch of
       * the same conditional.
       */
      userFindUnique.mockResolvedValue({
        mfaEnabled: true,
        mfaRecoveryCodes: ['hash1', 'hash2', 'hash3', 'hash4', 'hash5'],
      });

      const status = await service.getMfaStatus('user-1', 'tenant-acme');

      expect(status.enabled).toBe(true);
      expect(status.recoveryCodesRemaining).toBe(5);
      expect(status.recoveryCodesTotal).toBe(8);
    });

    it('throws UnauthorizedException when the (userId, tenantId) pair has no row', async () => {
      /*
       * Scenario: a JWT outlives a deleted user, or a guessed
       * (userId, tenantId) pair points at no row. The service must
       * refuse to leak a default snapshot and surface 401 instead — the
       * client should be forced through re-authentication, not allowed
       * to render a "no MFA" page that looks deceptively normal.
       */
      userFindUnique.mockResolvedValue(null);

      await expect(service.getMfaStatus('user-1', 'tenant-acme')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('scopes the lookup by (id, tenantId) for tenant isolation', async () => {
      /*
       * Scenario: a user from tenant B must not be able to probe a user
       * in tenant A even with a guessed ID. The findUnique WHERE clause
       * must combine the two — pinning the call shape catches a future
       * refactor that drops the tenantId scoping.
       */
      userFindUnique.mockResolvedValue({ mfaEnabled: true, mfaRecoveryCodes: [] });

      await service.getMfaStatus('user-1', 'tenant-acme');

      const calls = userFindUnique.mock.calls as unknown as Array<
        [{ where: { id: string; tenantId: string } }]
      >;
      const args = calls[0]?.[0];
      expect(args).toBeDefined();
      expect(args?.where.id).toBe('user-1');
      expect(args?.where.tenantId).toBe('tenant-acme');
    });

    it('returns required=false when MFA_REQUIRED_TENANT_SLUGS is empty', async () => {
      /*
       * Scenario: a vanilla dev / e2e environment has the env var unset
       * or empty. The status snapshot must report `required: false` so
       * the dashboard shell does NOT redirect and the security banner
       * stays hidden — pinning the default-off behaviour catches a
       * future change that would accidentally surface enforcement to
       * every workspace.
       */
      userFindUnique.mockResolvedValue({ mfaEnabled: false, mfaRecoveryCodes: [] });
      configGet.mockReturnValue('');

      const status = await service.getMfaStatus('user-1', 'tenant-acme');

      expect(status.required).toBe(false);
    });

    it('returns required=true when the user tenant id matches a configured slug', async () => {
      /*
       * Scenario: the env var lists `globex` and the user is in the
       * globex tenant. The status snapshot must report `required: true`
       * so the dashboard shell knows to redirect to /dashboard/security
       * and the banner explains why. Protects the slug → tenant CUID
       * resolution path through `prisma.tenant.findMany` plus the
       * `requiredTenantIds.has(tenantId)` check.
       */
      userFindUnique.mockResolvedValue({ mfaEnabled: false, mfaRecoveryCodes: [] });
      configGet.mockReturnValue('globex');
      tenantFindMany.mockResolvedValueOnce([{ id: 'tenant-globex-cuid' }]);

      const status = await service.getMfaStatus('user-globex', 'tenant-globex-cuid');

      expect(status.required).toBe(true);
    });

    it('returns required=false when the user is in a non-required tenant', async () => {
      /*
       * Scenario: globex requires MFA but the caller is in acme. The
       * snapshot must NOT mark acme as required — pinning the `has()`
       * lookup against the resolved CUID set so a future refactor that
       * widens the check to `length > 0` (broken) surfaces as a test
       * failure rather than silently enforcing globally.
       */
      userFindUnique.mockResolvedValue({ mfaEnabled: false, mfaRecoveryCodes: [] });
      configGet.mockReturnValue('globex');
      tenantFindMany.mockResolvedValueOnce([{ id: 'tenant-globex-cuid' }]);

      const status = await service.getMfaStatus('user-acme', 'tenant-acme-cuid');

      expect(status.required).toBe(false);
    });

    it('treats undefined env var the same as empty (defence in depth)', async () => {
      /*
       * Scenario: ConfigService.get returns `undefined` when the key is
       * unset. The service's nullish-coalescing fallback must coerce that
       * to `''` so the slug list is empty and no DB lookup fires. Pinning
       * the `??` branch so a refactor to `||` (which would also coerce
       * the empty string back through the same path) doesn't regress.
       */
      userFindUnique.mockResolvedValue({ mfaEnabled: false, mfaRecoveryCodes: [] });
      configGet.mockReturnValue(undefined);

      const status = await service.getMfaStatus('user-1', 'tenant-acme');

      expect(status.required).toBe(false);
      expect(tenantFindMany).not.toHaveBeenCalled();
    });

    it('memoizes the required-tenant lookup across multiple calls', async () => {
      /*
       * Scenario: the security page typically calls /account/mfa more
       * than once during a session (mount + after enrol). The service
       * must hit `prisma.tenant.findMany` only on the first call so
       * the hot path stays cheap. Protects the `requiredTenantIds`
       * cache against a future refactor that drops the memo.
       */
      userFindUnique.mockResolvedValue({ mfaEnabled: true, mfaRecoveryCodes: [] });
      configGet.mockReturnValue('globex');
      tenantFindMany.mockResolvedValueOnce([{ id: 'tenant-globex-cuid' }]);

      await service.getMfaStatus('user-1', 'tenant-globex-cuid');
      await service.getMfaStatus('user-1', 'tenant-globex-cuid');

      expect(tenantFindMany).toHaveBeenCalledTimes(1);
    });
  });

  // ─── verifyScrypt guard — stored-hash format edge cases ────────────────────

  // ─── Database call-shape pinning ───────────────────────────────────────────

  describe('database call shapes and exception messages', () => {
    it('listWorkspaces requests {id, slug, name} from the tenant relation and scopes by ACTIVE status', async () => {
      /*
       * Scenario: the workspace switcher UI displays the tenant slug,
       * name, and id for every workspace the user can sign in to.
       * A drift that drops any of these columns (or stops scoping by
       * ACTIVE status) would either render an empty dropdown or
       * surface suspended workspaces, both of which are visible UI
       * regressions and a potential privacy leak.
       */
      userFindUnique.mockResolvedValue({ email: 'sole@example.dev' });
      userFindMany.mockResolvedValue([]);

      await service.listWorkspaces('user-1', 'tenant-acme');

      const calls = userFindMany.mock.calls as unknown as Array<
        [
          {
            where: { email: string; status: string };
            select: {
              tenantId: boolean;
              role: boolean;
              tenant: { select: { id: boolean; slug: boolean; name: boolean } };
            };
          },
        ]
      >;
      const args = calls[0]?.[0];
      expect(args?.where).toEqual({ email: 'sole@example.dev', status: 'ACTIVE' });
      expect(args?.select).toEqual({
        tenantId: true,
        role: true,
        tenant: { select: { id: true, slug: true, name: true } },
      });
    });

    it('findSwitchTarget target lookup requests {id, status, tenant.slug} via the (tenantId, email) composite key', async () => {
      /*
       * Scenario: switching workspaces requires the destination row's
       * id (to mint the new session), status (to refuse SUSPENDED /
       * BANNED accounts), and the destination slug (for the audit log
       * and UI breadcrumb). Pinning the select shape protects the API
       * contract — a future refactor that omits `status` would silently
       * let suspended users complete the switch, the kind of bug that
       * never surfaces in green-path tests.
       */
      userFindUnique.mockResolvedValueOnce({ email: 'admin@example.dev' });
      userFindUnique.mockResolvedValueOnce({
        id: 'user-target',
        status: 'ACTIVE',
        tenant: { slug: 'globex' },
      });

      await service.findSwitchTarget('user-1', 'tenant-acme', 'tenant-globex');

      const calls = userFindUnique.mock.calls as unknown as Array<
        [
          {
            where: Record<string, unknown>;
            select: {
              id?: boolean;
              status?: boolean;
              tenant?: { select: { slug: boolean } };
              email?: boolean;
            };
          },
        ]
      >;
      // Second call is the target lookup; first is the caller email lookup.
      const targetCall = calls[1]?.[0];
      expect(targetCall?.select).toEqual({
        id: true,
        status: true,
        tenant: { select: { slug: true } },
      });
    });

    it('findSwitchTarget rejects a self-switch with the documented user-facing message', async () => {
      /*
       * Scenario: the workspace switcher accidentally re-selects the
       * current workspace (the row remains visible until the page
       * refreshes). The 400 response must carry the literal text the
       * UI surfaces in a toast — an empty body would leave the user
       * staring at a silent failure.
       */
      await expect(
        service.findSwitchTarget('user-1', 'tenant-acme', 'tenant-acme'),
      ).rejects.toThrow('You are already signed in to this workspace.');
    });

    it('findSwitchTarget surfaces the documented message when the caller row is missing', async () => {
      /*
       * Scenario: the JWT outlives a deleted user row (admin removed
       * the account in another tab). The 401 response message tells
       * the user their session is no longer valid, and the global
       * error handler escalates to a sign-out.
       */
      userFindUnique.mockResolvedValueOnce(null);

      await expect(
        service.findSwitchTarget('ghost', 'tenant-acme', 'tenant-globex'),
      ).rejects.toThrow('Your account could not be resolved.');
    });

    it('findSwitchTarget surfaces the documented 404 message when no row exists in the target workspace', async () => {
      /*
       * Scenario: the user's workspace list was loaded earlier and the
       * admin of the target workspace removed the user since. The 404
       * message tells the UI to refresh the dropdown — distinct from
       * the 403 below, so the toast can differentiate "no longer a
       * member" from "your account is suspended here".
       */
      userFindUnique.mockResolvedValueOnce({ email: 'admin@example.dev' });
      userFindUnique.mockResolvedValueOnce(null);

      await expect(
        service.findSwitchTarget('user-1', 'tenant-acme', 'tenant-globex'),
      ).rejects.toThrow('You do not have access to this workspace.');
    });

    it('findSwitchTarget surfaces the documented 403 message when the target row exists but is not ACTIVE', async () => {
      /*
       * Scenario: the user is suspended in the destination workspace
       * but still listed in the dropdown because the page loaded
       * before the suspension. The 403 message is distinct from the
       * 404 above so the UI can show "Your account in <workspace> is
       * suspended" instead of the generic "no access" message.
       */
      userFindUnique.mockResolvedValueOnce({ email: 'admin@example.dev' });
      userFindUnique.mockResolvedValueOnce({
        id: 'user-target',
        status: 'SUSPENDED',
        tenant: { slug: 'globex' },
      });

      await expect(
        service.findSwitchTarget('user-1', 'tenant-acme', 'tenant-globex'),
      ).rejects.toThrow('Your account in the target workspace is not active.');
    });

    it('getMfaStatus requests exactly {mfaEnabled, mfaRecoveryCodes, passwordHash} from prisma.user', async () => {
      /*
       * Scenario: the security page reads the MFA snapshot to render
       * the recovery-code counter. The select clause MUST stay narrow:
       * widening it would pull the encrypted TOTP secret and recovery
       * code hashes through the service boundary, exactly the leak the
       * focused projection prevents. Pinning the requested columns
       * keeps the surface area minimal.
       */
      userFindUnique.mockResolvedValue({ mfaEnabled: true, mfaRecoveryCodes: ['h1', 'h2'] });

      await service.getMfaStatus('user-1', 'tenant-acme');

      const calls = userFindUnique.mock.calls as unknown as Array<
        [{ where: { id: string; tenantId: string }; select: Record<string, boolean> }]
      >;
      expect(calls[0]?.[0].select).toEqual({
        mfaEnabled: true,
        mfaRecoveryCodes: true,
        // Presence only — the hash itself never leaves the service.
        passwordHash: true,
      });
    });

    it('getMfaStatus reports hasPassword false for an OAuth-only account', async () => {
      /*
       * Scenario: an account created through OAuth has no `passwordHash`. The
       * library skips password re-authentication for those on MFA setup, so
       * the UI needs this flag to know not to demand a password the user does
       * not have — without it, MFA enrollment is unreachable for every OAuth
       * account.
       * Protects: the null check, and that only presence is exposed — the hash
       * itself must never appear in the response.
       */
      userFindUnique.mockResolvedValue({
        mfaEnabled: false,
        mfaRecoveryCodes: [],
        passwordHash: null,
      });

      const status = await service.getMfaStatus('user-1', 'tenant-acme');

      expect(status.hasPassword).toBe(false);
      expect(JSON.stringify(status)).not.toContain('passwordHash');
    });

    it('getMfaStatus reports hasPassword true for a local-password account', async () => {
      /*
       * Scenario: the mirror case. A stored hash means the setup form must
       * keep asking for the password, so the flag has to distinguish the two
       * rather than defaulting one way.
       * Protects: the true arm of the same check.
       */
      userFindUnique.mockResolvedValue({
        mfaEnabled: false,
        mfaRecoveryCodes: [],
        passwordHash: '$scrypt$ln=17,r=8,p=1$c2FsdA$aGFzaA',
      });

      const status = await service.getMfaStatus('user-1', 'tenant-acme');

      expect(status.hasPassword).toBe(true);
    });

    it('getMfaStatus surfaces the documented 401 message when the user row is missing', async () => {
      /*
       * Scenario: the JWT outlives a deleted user row. The MFA
       * endpoint must respond with a 401 carrying the literal text
       * the UI maps to a hard sign-out — a different message would
       * leave the dashboard rendering a fake "no MFA configured"
       * card to a user with no actual session.
       */
      userFindUnique.mockResolvedValue(null);

      await expect(service.getMfaStatus('user-1', 'tenant-acme')).rejects.toThrow(
        'User account not found.',
      );
    });

    it('getRequiredTenantIds queries tenants by slug list and returns only ids', async () => {
      /*
       * Scenario: the MFA-required policy lives as an env-configured
       * list of tenant slugs. Resolution to tenant ids must use the
       * slug list verbatim (over-matching would silently enforce MFA
       * across every tenant) and the returned projection must be
       * narrow to {id} (over-selecting would leak unrelated tenant
       * columns through the policy resolution path).
       */
      userFindUnique.mockResolvedValue({ mfaEnabled: false, mfaRecoveryCodes: [] });
      configGet.mockReturnValue('globex,acme');
      tenantFindMany.mockResolvedValueOnce([
        { id: 'tenant-globex-cuid' },
        { id: 'tenant-acme-cuid' },
      ]);

      await service.getMfaStatus('user-1', 'tenant-globex-cuid');

      const calls = tenantFindMany.mock.calls as unknown as Array<
        [{ where: { slug: { in: string[] } }; select: { id: boolean } }]
      >;
      const args = calls[0]?.[0];
      expect(args?.where).toEqual({ slug: { in: ['globex', 'acme'] } });
      expect(args?.select).toEqual({ id: true });
    });

    it('places the current workspace first when its name sorts AFTER the other workspace name', async () => {
      /*
       * Scenario: the user's current workspace has a name that
       * would sort LAST alphabetically (e.g. "Zeta Co"), but the
       * UI must still surface it first as the active workspace.
       * The sort comparator must respect the current-first rule
       * regardless of alphabetical order — a regression that
       * dropped the current-first short-circuit would push the
       * active workspace to the bottom of the dropdown.
       */
      userFindUnique.mockResolvedValue({ email: 'admin@example.dev' });
      userFindMany.mockResolvedValue([
        {
          tenantId: 'tenant-acme',
          role: 'ADMIN',
          tenant: { id: 'tenant-acme', slug: 'acme', name: 'Acme Corp' },
        },
        {
          tenantId: 'tenant-zeta',
          role: 'ADMIN',
          tenant: { id: 'tenant-zeta', slug: 'zeta', name: 'Zeta Co' },
        },
      ]);

      const result = await service.listWorkspaces('user-1', 'tenant-zeta');

      // Zeta is current and must come first even though it sorts after Acme.
      expect(result.map((w) => w.tenantSlug)).toEqual(['zeta', 'acme']);
      expect(result[0]?.isCurrent).toBe(true);
    });

    it('logs the validated switch-target event with the documented payload on success', async () => {
      /*
       * Scenario: a successful workspace switch must surface in
       * operator logs with the canonical event name and the four
       * actor/target identifiers so support can trace which user
       * moved between which tenants. A drift that dropped any
       * identifier would leave the audit trail incomplete.
       */
      userFindUnique.mockResolvedValueOnce({ email: 'admin@example.dev' });
      userFindUnique.mockResolvedValueOnce({
        id: 'user-target-globex',
        status: 'ACTIVE',
        tenant: { slug: 'globex' },
      });
      const logSpy = jest
        .spyOn((service as unknown as { logger: { log: (m: unknown) => void } }).logger, 'log')
        .mockImplementation(() => undefined);

      await service.findSwitchTarget('user-1', 'tenant-acme', 'tenant-globex');

      expect(logSpy).toHaveBeenCalledTimes(1);
      const arg = logSpy.mock.calls[0]?.[0] as {
        msg?: string;
        currentUserId?: string;
        currentTenantId?: string;
        targetUserId?: string;
        targetTenantId?: string;
      };
      expect(arg.msg).toBe('switchWorkspace: validated switch target');
      expect(arg.currentUserId).toBe('user-1');
      expect(arg.currentTenantId).toBe('tenant-acme');
      expect(arg.targetUserId).toBe('user-target-globex');
      expect(arg.targetTenantId).toBe('tenant-globex');
    });

    it('logs the password-updated event with the documented payload on success', async () => {
      /*
       * Scenario: a successful password change must surface in
       * operator logs with the canonical event message and the
       * affected userId so support can trace credential rotations
       * (especially during incident response).
       */
      const storedHash = await makeHash('CorrectPassword1!');
      userFindUnique.mockResolvedValue({ id: 'user-1', passwordHash: storedHash });
      userUpdate.mockResolvedValue({});
      const logSpy = jest
        .spyOn((service as unknown as { logger: { log: (m: unknown) => void } }).logger, 'log')
        .mockImplementation(() => undefined);

      await service.changePassword('user-claire', 'tenant-acme', {
        currentPassword: 'CorrectPassword1!',
        newPassword: 'NewPassword2!',
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      const arg = logSpy.mock.calls[0]?.[0] as { msg?: string; userId?: string };
      expect(arg.msg).toBe('changePassword: password updated');
      expect(arg.userId).toBe('user-claire');
    }, 30_000);
  });
});
