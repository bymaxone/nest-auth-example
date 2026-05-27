/**
 * @file tenant-mfa-policy.guard.spec.ts
 * @description Unit tests for `TenantMfaPolicyGuard` — tenant-level MFA
 * enforcement that complements the lib's `MfaRequiredGuard`.
 *
 * Verifies:
 * - Empty `MFA_REQUIRED_TENANT_SLUGS` short-circuits the guard to allow
 *   every request (zero-cost default for projects that do not opt in).
 * - `@SkipMfa()` (lib's `SKIP_MFA_KEY` reflector metadata) bypasses
 *   enforcement so MFA setup endpoints stay reachable.
 * - Lib auth-flow paths (`/api/auth/*`, `/auth/*`) bypass enforcement so
 *   the AuthProvider's `/me` call does not 403 immediately after login.
 * - Users in a required tenant without MFA are rejected with
 *   `AuthException(MFA_SETUP_REQUIRED)` and HTTP 403.
 * - Users in a required tenant WITH MFA are allowed through.
 * - Users in a non-required tenant are allowed regardless of MFA state.
 * - Unauthenticated requests (no `request.user`) pass through — the
 *   JwtAuthGuard upstream handles rejection.
 *
 * @layer test
 * @see apps/api/src/auth/tenant-mfa-policy.guard.ts
 */

import { jest } from '@jest/globals';
import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { AUTH_ERROR_CODES, AuthException, SKIP_MFA_KEY } from '@bymax-one/nest-auth';
import type { ExecutionContext } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import { TenantMfaPolicyGuard, parseRequiredTenantSlugs } from './tenant-mfa-policy.guard.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Builds a minimal `ExecutionContext` whose `getHandler` / `getClass` return
 * sentinel symbols (matched by the reflector mock) and whose
 * `switchToHttp().getRequest()` returns the given request shape.
 *
 * @param request - Object exposing the fields the guard reads (`originalUrl`,
 *   `user`, etc.). Any field can be omitted to assert absence.
 */
function makeContext(request: Record<string, unknown>): ExecutionContext {
  const handler = jest.fn();
  const cls = jest.fn();
  return {
    getHandler: () => handler as unknown,
    getClass: () => cls as unknown,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: jest.fn(),
      getNext: jest.fn(),
    }),
  } as unknown as ExecutionContext;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('parseRequiredTenantSlugs', () => {
  it('returns an empty array for an empty input', () => {
    /*
     * Scenario: developer leaves the env var unset / empty. The parser
     * must return `[]` so the guard's "no enforcement" short-circuit
     * fires. Pinned to surface a future regression that returns `['']`
     * (which would try to resolve an empty slug and warn-spam the logs).
     */
    expect(parseRequiredTenantSlugs('')).toEqual([]);
  });

  it('trims whitespace and drops empty entries', () => {
    /*
     * Scenario: the value comes from a .env file where humans add
     * spaces. The parser must normalise so `globex, ,  acme` becomes
     * `['globex', 'acme']` — pinned because shell paste behaviour often
     * sneaks in stray separators.
     */
    expect(parseRequiredTenantSlugs('globex, ,  acme')).toEqual(['globex', 'acme']);
  });
});

describe('TenantMfaPolicyGuard', () => {
  let guard: TenantMfaPolicyGuard;
  let reflectorGet: jest.Mock<(key: unknown, targets: unknown[]) => boolean | undefined>;
  let configGet: jest.Mock<(key: string) => string | undefined>;
  let tenantFindMany: jest.Mock<() => Promise<Array<{ id: string; slug: string }>>>;

  beforeEach(async () => {
    reflectorGet = jest.fn();
    configGet = jest.fn<(key: string) => string | undefined>();
    tenantFindMany = jest.fn();

    // Defaults: no @SkipMfa, no required slugs. Individual tests override.
    reflectorGet.mockReturnValue(undefined);
    configGet.mockReturnValue('');
    tenantFindMany.mockResolvedValue([]);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        TenantMfaPolicyGuard,
        { provide: Reflector, useValue: { getAllAndOverride: reflectorGet } },
        { provide: ConfigService, useValue: { get: configGet } },
        { provide: PrismaService, useValue: { tenant: { findMany: tenantFindMany } } },
      ],
    }).compile();

    guard = moduleRef.get(TenantMfaPolicyGuard);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('onModuleInit', () => {
    it('treats an undefined env var the same as an empty string (no enforcement)', async () => {
      /*
       * Scenario: in tests / fresh installs ConfigService.get returns
       * `undefined` for an unset key. The guard must coalesce that to
       * `''` and short-circuit — pinning the nullish-coalescing fallback
       * so a future refactor that uses `||` (which would also coerce
       * "0" or empty arrays) doesn't regress this branch.
       */
      configGet.mockReturnValue(undefined);

      await guard.onModuleInit();

      expect(tenantFindMany).not.toHaveBeenCalled();
    });

    it('skips DB lookup when the env var is empty', async () => {
      /*
       * Scenario: the default config (empty MFA_REQUIRED_TENANT_SLUGS)
       * must not hit Postgres at boot. Pinning saves a DB round-trip
       * on every startup for projects that never opt into the policy.
       */
      configGet.mockReturnValue('');

      await guard.onModuleInit();

      expect(tenantFindMany).not.toHaveBeenCalled();
    });

    it('resolves slugs to tenant CUIDs via Prisma', async () => {
      /*
       * Scenario: the env var lists slugs but the guard enforces by
       * `User.tenantId` which is a CUID. The init must hit
       * `tenant.findMany` with the slug list to populate the in-memory
       * set with CUIDs — pinning the query shape so a future refactor
       * that drops the WHERE clause doesn't silently enforce on every
       * tenant.
       */
      configGet.mockReturnValue('globex');
      tenantFindMany.mockResolvedValueOnce([{ id: 'tenant-globex-cuid', slug: 'globex' }]);

      await guard.onModuleInit();

      expect(tenantFindMany).toHaveBeenCalledTimes(1);
      const calls = tenantFindMany.mock.calls as unknown as Array<
        [{ where: { slug: { in: string[] } } }]
      >;
      expect(calls[0]?.[0]?.where.slug.in).toEqual(['globex']);
    });

    it('warns and ignores slugs that do not match any tenant', async () => {
      /*
       * Scenario: the developer types `globix` (typo). The guard must
       * NOT crash boot — startup is too critical for a config typo to
       * take down the API — but it must log a warning so the typo is
       * visible in the logs. Pinning catches a regression that would
       * either fail-fast (over-aggressive) or silently swallow the
       * typo (over-permissive).
       */
      configGet.mockReturnValue('globix,globex');
      tenantFindMany.mockResolvedValueOnce([{ id: 'tenant-globex-cuid', slug: 'globex' }]);
      const loggerWarn = jest.spyOn(guard['logger'], 'warn').mockImplementation(() => undefined);

      await guard.onModuleInit();

      expect(loggerWarn).toHaveBeenCalledWith(expect.objectContaining({ slugs: ['globix'] }));
    });
  });

  describe('canActivate', () => {
    it('short-circuits to true when no tenants require MFA (default config)', () => {
      /*
       * Scenario: default config — env var empty, no DB query happened.
       * The guard must return true without inspecting reflector / request
       * at all. Pinned as the hot-path no-op for projects that never
       * opt into the policy.
       */
      const context = makeContext({ user: { mfaEnabled: false, tenantId: 'any' } });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('short-circuits to true when @SkipMfa() is set on the route', async () => {
      /*
       * Scenario: routes that drive the enrolment flow itself (POST
       * /mfa/setup, POST /mfa/verify-enable, GET /account/mfa) must NOT
       * be blocked even when the user is in a required tenant. The
       * `@SkipMfa()` decorator (same key as the lib's `MfaRequiredGuard`)
       * must opt out. Without this an enrolling user would hit a wall
       * trying to verify their own setup payload.
       */
      await initGuardWithGlobexRequired();
      reflectorGet.mockReturnValueOnce(true);
      const context = makeContext({
        originalUrl: '/api/projects',
        user: { mfaEnabled: false, tenantId: 'tenant-globex-cuid' },
      });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('short-circuits to true for lib auth-flow paths', async () => {
      /*
       * Scenario: a user in globex without MFA opens the dashboard. The
       * AuthProvider's first call is `GET /api/auth/me`. The guard MUST
       * allow that request to succeed; rejecting it would dispatch
       * CLEAR_SESSION in the lib's revalidate and bounce the user to
       * /auth/login in a loop with no escape. Pinning the auth-prefix
       * carve-out catches a refactor that would tighten it.
       */
      await initGuardWithGlobexRequired();
      const context = makeContext({
        originalUrl: '/api/auth/me',
        user: { mfaEnabled: false, tenantId: 'tenant-globex-cuid' },
      });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('falls back to "" when request has no url-like field (defence in depth)', async () => {
      /*
       * Scenario: a synthetic ExecutionContext (e.g. from a non-HTTP
       * adapter) yields a request without `originalUrl` / `url` / `path`.
       * The guard must not crash on `undefined.startsWith` — it falls
       * through to the user check and enforces normally. Pinning the
       * `?? ''` chain so a refactor that drops any link doesn't surface
       * as a runtime TypeError on a misconfigured route.
       */
      await initGuardWithGlobexRequired();
      const context = makeContext({
        // No originalUrl/url/path on this request.
        user: { mfaEnabled: false, tenantId: 'tenant-globex-cuid' },
      });

      expect(() => guard.canActivate(context)).toThrow(AuthException);
    });

    it('short-circuits to true when request.user is undefined', async () => {
      /*
       * Scenario: an anonymous request slips through to this guard
       * (e.g. a misconfigured route order). The guard must NOT throw —
       * `JwtAuthGuard` is the source of truth for "is the user
       * authenticated", and stacking the auth decision here would
       * leak a 403 where a 401 belongs.
       */
      await initGuardWithGlobexRequired();
      const context = makeContext({ originalUrl: '/api/projects' });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('allows users in a non-required tenant regardless of MFA state', async () => {
      /*
       * Scenario: globex is required, but the caller is in acme. The
       * guard must not enforce on acme users — pinning the tenant scope
       * so a refactor that widens the check to "any tenant" surfaces.
       */
      await initGuardWithGlobexRequired();
      const context = makeContext({
        originalUrl: '/api/projects',
        user: { mfaEnabled: false, tenantId: 'tenant-acme-cuid' },
      });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('allows users in a required tenant who have MFA enabled', async () => {
      /*
       * Scenario: a globex user has completed enrolment. The guard's
       * job is finished — every subsequent request goes through
       * untouched. Pinning the `mfaEnabled === true` happy path.
       */
      await initGuardWithGlobexRequired();
      const context = makeContext({
        originalUrl: '/api/projects',
        user: { mfaEnabled: true, tenantId: 'tenant-globex-cuid' },
      });

      expect(guard.canActivate(context)).toBe(true);
    });

    it('throws MFA_SETUP_REQUIRED for users in a required tenant without MFA', async () => {
      /*
       * Scenario: the policy violator path — a globex user without MFA
       * tries to read /api/projects. The guard must throw
       * AuthException(MFA_SETUP_REQUIRED) with HTTP 403 so the web app
       * can intercept the code and redirect to /dashboard/security.
       * Pinning both the code and the status — they are the contract
       * between the API and the UI.
       */
      await initGuardWithGlobexRequired();
      const context = makeContext({
        originalUrl: '/api/projects',
        user: { mfaEnabled: false, tenantId: 'tenant-globex-cuid' },
      });

      try {
        guard.canActivate(context);
        throw new Error('expected canActivate to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(AuthException);
        const ex = err as AuthException;
        expect(ex.getStatus()).toBe(HttpStatus.FORBIDDEN);
        // AuthException stores the code inside its response body
        // (`{ error: { code, message, details } }`) rather than on a
        // direct property — see the lib bundle's class definition.
        const body = ex.getResponse() as { error?: { code?: string } };
        expect(body.error?.code).toBe(AUTH_ERROR_CODES.MFA_SETUP_REQUIRED);
      }
    });

    it('asks the Reflector for SKIP_MFA_KEY on both handler and class', async () => {
      /*
       * Scenario: a controller that wants to bypass enforcement may
       * apply `@SkipMfa()` at the class level (e.g., a whole admin
       * controller). The guard must look at both handler and class
       * targets — pinned to mirror the lib's `MfaRequiredGuard`
       * behaviour and avoid surprising divergences.
       */
      await initGuardWithGlobexRequired();
      const context = makeContext({
        originalUrl: '/api/projects',
        user: { mfaEnabled: false, tenantId: 'tenant-acme-cuid' },
      });

      guard.canActivate(context);

      expect(reflectorGet).toHaveBeenCalledWith(
        SKIP_MFA_KEY,
        expect.arrayContaining([expect.anything(), expect.anything()]),
      );
    });
  });

  /**
   * Helper to initialise the guard with globex as a required tenant.
   * Most enforcement tests share this setup, so this avoids retyping it.
   */
  async function initGuardWithGlobexRequired(): Promise<void> {
    configGet.mockReturnValue('globex');
    tenantFindMany.mockResolvedValueOnce([{ id: 'tenant-globex-cuid', slug: 'globex' }]);
    await guard.onModuleInit();
  }
});
