/**
 * @file debug.controller.spec.ts
 * @description Unit tests for `DebugController`.
 *
 * Verifies that:
 * - `POST /debug/lockout` sets the correct Redis key with the correct value and TTL.
 * - The key format matches the library's brute-force namespace convention.
 * - The handler throws `ForbiddenException` when `NODE_ENV === 'production'`.
 *
 * The Redis client is mocked via the `BYMAX_AUTH_REDIS_CLIENT` injection token
 * to avoid any real connection. `process.env['NODE_ENV']` is manipulated per
 * test to exercise the production guard branch.
 *
 * @layer test
 * @see apps/api/src/debug/debug.controller.ts
 */

import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { BYMAX_AUTH_REDIS_CLIENT, sha256 } from '@bymax-one/nest-auth';

import { DebugController } from './debug.controller.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Namespace constant that mirrors the private static in `DebugController`. */
const REDIS_NAMESPACE = 'nest-auth-example';

/** Computes the expected Redis key for a given `(tenantId, email)` pair. */
function expectedKey(tenantId: string, email: string): string {
  const hash = sha256(`${tenantId}:${email.toLowerCase()}`);
  return `${REDIS_NAMESPACE}:lf:${hash}`;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('DebugController', () => {
  let controller: DebugController;
  let redisSet: jest.Mock<() => Promise<string | null>>;

  const originalEnv = process.env['NODE_ENV'];

  beforeEach(async () => {
    redisSet = jest.fn<() => Promise<string | null>>();
    redisSet.mockResolvedValue('OK');

    const moduleRef = await Test.createTestingModule({
      controllers: [DebugController],
      providers: [
        {
          provide: BYMAX_AUTH_REDIS_CLIENT,
          useValue: { set: redisSet },
        },
      ],
    }).compile();

    controller = moduleRef.get(DebugController);
  });

  afterEach(() => {
    jest.resetAllMocks();
    // Restore the original NODE_ENV after each test that mutates it.
    process.env['NODE_ENV'] = originalEnv;
  });

  // ─── lockout ─────────────────────────────────────────────────────────────

  describe('lockout', () => {
    it('sets the correct Redis key with maxAttempts+1 and a 900-second TTL', async () => {
      // The key format must mirror the library's internal BruteForceService key
      // so the lockout is recognised by the library without code duplication.
      process.env['NODE_ENV'] = 'development';

      const result = await controller.lockout({ tenantId: 'tenant-1', email: 'Alice@Example.com' });

      const key = expectedKey('tenant-1', 'alice@example.com');
      expect(result).toEqual({ locked: true, key });
      expect(redisSet).toHaveBeenCalledWith(key, '6', 'EX', 900);
    });

    it('lowercases the email before hashing to match the library key derivation', async () => {
      // Brute-force keys are always built from the lowercased address; an
      // uppercase mismatch would produce a different key and leave the account
      // unlocked despite calling this endpoint.
      process.env['NODE_ENV'] = 'test';

      const lowerResult = await controller.lockout({
        tenantId: 'tenant-1',
        email: 'user@example.com',
      });
      jest.resetAllMocks();
      redisSet.mockResolvedValue('OK');

      const upperResult = await controller.lockout({
        tenantId: 'tenant-1',
        email: 'USER@EXAMPLE.COM',
      });

      expect(lowerResult.key).toBe(upperResult.key);
    });

    it('throws ForbiddenException with the documented "Not available" message in production', async () => {
      /*
       * Scenario: even if the module is accidentally wired in
       * production, the handler must refuse to execute AND
       * carry a recognisable error message so operators can
       * spot the gate's intent in 403 responses.
       */
      process.env['NODE_ENV'] = 'production';

      await expect(
        controller.lockout({ tenantId: 'tenant-1', email: 'user@example.com' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        controller.lockout({ tenantId: 'tenant-1', email: 'user@example.com' }),
      ).rejects.toThrow('Not available');

      expect(redisSet).not.toHaveBeenCalled();
    });

    it('returns locked:true on a successful Redis set', async () => {
      // The caller relies on locked:true to confirm the operation succeeded.
      process.env['NODE_ENV'] = 'development';

      const result = await controller.lockout({ tenantId: 'tenant-1', email: 'user@example.com' });

      expect(result.locked).toBe(true);
    });
  });
});
