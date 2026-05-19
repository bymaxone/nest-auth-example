/**
 * @file redis.provider.spec.ts
 * @description Unit tests for the `redisProvider` factory.
 *
 * Verifies that:
 * - `useFactory` reads `REDIS_URL` from `ConfigService` via `getOrThrow`.
 * - `useFactory` returns a Redis instance constructed with the URL and
 *   the required options (`lazyConnect`, `maxRetriesPerRequest`, `retryStrategy`).
 * - `retryStrategy` caps its delay at 2 000 ms with exponential back-off.
 *
 * `ioredis` is mocked via `jest.unstable_mockModule` to prevent real TCP
 * connections during the test run.
 *
 * @layer test
 * @see apps/api/src/redis/redis.provider.ts
 */

import { jest } from '@jest/globals';

// ─── ESM mock — must appear before any import that pulls in ioredis ──────────

const mockRedisConstructor = jest.fn();

jest.unstable_mockModule('ioredis', () => ({
  Redis: mockRedisConstructor,
}));

// ─── Imports (after mock registration) ───────────────────────────────────────

const { redisProvider } = await import('./redis.provider.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal ConfigService stub that returns the provided Redis URL. */
function makeConfigService(url: string) {
  return {
    getOrThrow: jest.fn<(key: string) => string>().mockReturnValue(url),
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('redisProvider.useFactory', () => {
  // The provider token must be BYMAX_AUTH_REDIS_CLIENT so the library's auth
  // middleware resolves the Redis client correctly.
  const REDIS_TEST_URL = 'redis://localhost:6379/0';

  beforeEach(() => {
    jest.clearAllMocks();
    // Return a sentinel object so callers can verify the constructor was invoked
    // and the result is passed through as-is.
    mockRedisConstructor.mockReturnValue({ _isMockRedis: true });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('reads REDIS_URL from ConfigService via getOrThrow', () => {
    // The factory must use getOrThrow (not get) so a missing REDIS_URL causes
    // a hard startup failure rather than silently constructing a client pointing
    // to an undefined URL.
    const configService = makeConfigService(REDIS_TEST_URL);

    // useFactory is known to exist on this provider shape.
    const factory = (redisProvider as { useFactory: (c: typeof configService) => unknown })
      .useFactory;
    factory(configService);

    expect(configService.getOrThrow).toHaveBeenCalledWith('REDIS_URL');
  });

  it('constructs a Redis instance with the URL from ConfigService', () => {
    // The URL is passed as the first argument to the Redis constructor; an
    // incorrect URL would point the client at the wrong Redis instance.
    const configService = makeConfigService(REDIS_TEST_URL);

    const factory = (redisProvider as { useFactory: (c: typeof configService) => unknown })
      .useFactory;
    factory(configService);

    expect(mockRedisConstructor).toHaveBeenCalledWith(
      REDIS_TEST_URL,
      expect.objectContaining({ lazyConnect: true }),
    );
  });

  it('sets lazyConnect:true so a Redis outage does not block startup', () => {
    // lazyConnect prevents a hard start-up failure when Redis is temporarily
    // unreachable; the health endpoint should surface the outage instead.
    const configService = makeConfigService(REDIS_TEST_URL);

    const factory = (redisProvider as { useFactory: (c: typeof configService) => unknown })
      .useFactory;
    factory(configService);

    const opts = (mockRedisConstructor.mock.calls[0] as [string, Record<string, unknown>])[1];
    expect(opts['lazyConnect']).toBe(true);
  });

  it('sets maxRetriesPerRequest:null for blocking-command compatibility', () => {
    // BL* family commands require maxRetriesPerRequest=null; without it, ioredis
    // queues commands indefinitely on disconnect instead of failing fast.
    const configService = makeConfigService(REDIS_TEST_URL);

    const factory = (redisProvider as { useFactory: (c: typeof configService) => unknown })
      .useFactory;
    factory(configService);

    const opts = (mockRedisConstructor.mock.calls[0] as [string, Record<string, unknown>])[1];
    expect(opts['maxRetriesPerRequest']).toBeNull();
  });

  it('returns the Redis instance produced by the constructor', () => {
    // The factory must return the result of `new Redis(...)` so NestJS DI
    // injects the same instance everywhere BYMAX_AUTH_REDIS_CLIENT is requested.
    const configService = makeConfigService(REDIS_TEST_URL);

    const factory = (redisProvider as { useFactory: (c: typeof configService) => unknown })
      .useFactory;
    const result = factory(configService);

    expect(result).toEqual({ _isMockRedis: true });
  });

  // ─── retryStrategy ─────────────────────────────────────────────────────────

  describe('retryStrategy', () => {
    it('returns 200ms * attempt for small retry counts', () => {
      // Early retries back off linearly by 200 ms per attempt so transient
      // blips resolve quickly without hammering Redis.
      const configService = makeConfigService(REDIS_TEST_URL);
      const factory = (
        redisProvider as {
          useFactory: (c: typeof configService) => unknown;
        }
      ).useFactory;
      factory(configService);

      const opts = (mockRedisConstructor.mock.calls[0] as [string, Record<string, unknown>])[1];
      const retryStrategy = opts['retryStrategy'] as (times: number) => number;

      expect(retryStrategy(1)).toBe(200);
      expect(retryStrategy(5)).toBe(1_000);
    });

    it('caps the delay at 2 000ms regardless of attempt count', () => {
      // Without a cap, high attempt counts would produce unbounded delays,
      // effectively preventing reconnection after a prolonged Redis outage.
      const configService = makeConfigService(REDIS_TEST_URL);
      const factory = (
        redisProvider as {
          useFactory: (c: typeof configService) => unknown;
        }
      ).useFactory;
      factory(configService);

      const opts = (mockRedisConstructor.mock.calls[0] as [string, Record<string, unknown>])[1];
      const retryStrategy = opts['retryStrategy'] as (times: number) => number;

      expect(retryStrategy(20)).toBe(2_000);
      expect(retryStrategy(100)).toBe(2_000);
    });
  });
});
