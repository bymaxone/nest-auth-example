/**
 * @file debug.controller.spec.ts
 * @description Unit tests for `DebugController`.
 *
 * Verifies that:
 * - `POST /debug/lockout` replays wrong-password logins through the real
 *   `AuthService.login` path and reports the resulting lockout state.
 * - `GET /debug/lockout` reads state via `isAccountLockedOut` +
 *   `getAccountLockoutSeconds`.
 * - `DELETE /debug/lockout` delegates to `AuthService.unlockAccount`.
 * - Every handler requires the `X-Tenant-Id` header and throws
 *   `ForbiddenException` when `NODE_ENV === 'production'`.
 *
 * `AuthService` is mocked — no Redis or database is touched.
 * `process.env['NODE_ENV']` is manipulated per test to exercise the
 * production guard branch.
 *
 * @layer test
 * @see apps/api/src/debug/debug.controller.ts
 */

import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH_ERROR_CODES, AuthException, AuthService } from '@bymax-one/nest-auth';

import { DebugController } from './debug.controller.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a minimal Express request stub carrying the given headers. */
function makeRequest(headers: Record<string, string>): Request {
  return { headers } as unknown as Request;
}

/** Request stub with the tenant header the endpoints require. */
const TENANT_ID = 'tenant-1';
const reqWithTenant = (): Request => makeRequest({ 'x-tenant-id': TENANT_ID });

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('DebugController', () => {
  let controller: DebugController;
  let login: jest.Mock<() => Promise<never>>;
  let isAccountLockedOut: jest.Mock<() => Promise<boolean>>;
  let getAccountLockoutSeconds: jest.Mock<() => Promise<number>>;
  let unlockAccount: jest.Mock<() => Promise<void>>;

  const originalEnv = process.env['NODE_ENV'];

  beforeEach(async () => {
    // Each wrong-password replay is refused with the library's own exception —
    // the controller must swallow AuthException and keep looping.
    login = jest.fn<() => Promise<never>>();
    login.mockRejectedValue(new AuthException(AUTH_ERROR_CODES.INVALID_CREDENTIALS));
    isAccountLockedOut = jest.fn<() => Promise<boolean>>();
    isAccountLockedOut.mockResolvedValue(true);
    getAccountLockoutSeconds = jest.fn<() => Promise<number>>();
    getAccountLockoutSeconds.mockResolvedValue(900);
    unlockAccount = jest.fn<() => Promise<void>>();
    unlockAccount.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [DebugController],
      providers: [
        {
          provide: AuthService,
          useValue: { login, isAccountLockedOut, getAccountLockoutSeconds, unlockAccount },
        },
      ],
    }).compile();

    controller = moduleRef.get(DebugController);
  });

  afterEach(() => {
    process.env['NODE_ENV'] = originalEnv;
  });

  // Scenario: forcing a lockout replays exactly maxAttempts (5) failed logins
  // through AuthService.login — the real brute-force path — and then reports
  // the lockout state read back from the library. Protects FCM #16.
  it('POST /debug/lockout replays 5 wrong-password logins and reports state', async () => {
    process.env['NODE_ENV'] = 'test';
    const result = await controller.lockout({ email: 'user@example.com' }, reqWithTenant());

    expect(login).toHaveBeenCalledTimes(5);
    // The dto passed to the library must NOT name tenantId — the configured
    // tenantIdResolver (X-Tenant-Id header) is the single source of tenancy.
    const firstCall = login.mock.calls[0] as unknown as [
      { email: string; password: string; tenantId?: string },
      Request,
    ];
    expect(firstCall[0].email).toBe('user@example.com');
    expect(firstCall[0]).not.toHaveProperty('tenantId');
    // The password must be a value no account can hold, so the replay cannot
    // accidentally succeed and log the caller in instead of locking them out.
    // An empty string is exactly the kind of value a real account might have
    // been seeded with in a broken fixture.
    expect(firstCall[0].password).toMatch(/^debug-lockout-[0-9a-f-]{36}$/);
    expect(result).toEqual({ locked: true, retryAfterSeconds: 900 });
  });

  // Scenario: a non-AuthException failure inside the replay loop (e.g. a dead
  // database) must propagate — only expected auth refusals are swallowed.
  it('POST /debug/lockout rethrows unexpected non-auth errors', async () => {
    process.env['NODE_ENV'] = 'test';
    login.mockRejectedValueOnce(new Error('db down'));

    await expect(
      controller.lockout({ email: 'user@example.com' }, reqWithTenant()),
    ).rejects.toThrow('db down');
  });

  // Scenario: the status endpoint surfaces the library's lockout read side —
  // isAccountLockedOut + getAccountLockoutSeconds — scoped by the header tenant.
  it('GET /debug/lockout reads lockout state via the library', async () => {
    process.env['NODE_ENV'] = 'test';
    isAccountLockedOut.mockResolvedValue(false);
    getAccountLockoutSeconds.mockResolvedValue(0);

    const result = await controller.lockoutStatus({ email: 'user@example.com' }, reqWithTenant());

    expect(isAccountLockedOut).toHaveBeenCalledWith('user@example.com', TENANT_ID);
    expect(getAccountLockoutSeconds).toHaveBeenCalledWith('user@example.com', TENANT_ID);
    expect(result).toEqual({ locked: false, retryAfterSeconds: 0 });
  });

  // Scenario: the unlock endpoint delegates to AuthService.unlockAccount with
  // the header tenant — the admin-side early-unlock surface.
  it('DELETE /debug/lockout unlocks via AuthService.unlockAccount', async () => {
    process.env['NODE_ENV'] = 'test';
    await controller.unlock({ email: 'user@example.com' }, reqWithTenant());

    expect(unlockAccount).toHaveBeenCalledWith('user@example.com', TENANT_ID);
  });

  // Scenario: a request without the X-Tenant-Id header is refused — debug
  // endpoints follow the same header-tenanting rule as the rest of the API.
  it('refuses requests missing the X-Tenant-Id header', async () => {
    process.env['NODE_ENV'] = 'test';
    await expect(
      controller.lockout({ email: 'user@example.com' }, makeRequest({})),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.lockoutStatus({ email: 'user@example.com' }, makeRequest({})),
    ).rejects.toThrow(ForbiddenException);
    await expect(controller.unlock({ email: 'user@example.com' }, makeRequest({}))).rejects.toThrow(
      'X-Tenant-Id header is required',
    );
  });

  // Scenario: the header is present but empty. An empty string is not a tenant,
  // and treating it as one would let a request through with `tenantId: ''`,
  // which scopes every query to nothing rather than being refused outright.
  it('refuses an empty X-Tenant-Id header', async () => {
    process.env['NODE_ENV'] = 'test';
    await expect(
      controller.lockout({ email: 'user@example.com' }, makeRequest({ 'x-tenant-id': '' })),
    ).rejects.toThrow('X-Tenant-Id header is required');
  });

  // Scenario: in production every handler refuses outright — the debug surface
  // must be dead even if the module is accidentally wired in.
  it('throws ForbiddenException in production on every endpoint', async () => {
    process.env['NODE_ENV'] = 'production';
    await expect(
      controller.lockout({ email: 'user@example.com' }, reqWithTenant()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.lockoutStatus({ email: 'user@example.com' }, reqWithTenant()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.unlock({ email: 'user@example.com' }, reqWithTenant()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // The refusal message is deliberately bare: naming the endpoint or the
    // reason would confirm the debug surface exists to whoever probed it.
    await expect(
      controller.lockout({ email: 'user@example.com' }, reqWithTenant()),
    ).rejects.toThrow('Not available');
    expect(login).not.toHaveBeenCalled();
    expect(unlockAccount).not.toHaveBeenCalled();
  });
});
