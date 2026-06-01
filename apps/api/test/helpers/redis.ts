/**
 * @file redis.ts
 * @description Redis helper for e2e test suites.
 *
 * Provides `flushTestKeys` to delete all keys matching the application's
 * Redis namespace (`nest-auth-example:*`) without affecting other keyspaces.
 *
 * This is preferable to `FLUSHDB` because it leaves any other test processes'
 * keys intact when multiple test suites run concurrently.
 *
 * @layer test
 * @see docs/guidelines/redis-guidelines.md
 */

import type { Redis } from 'ioredis';

/** Default key pattern matching all library and application-owned keys. */
const TEST_KEY_PATTERN = 'nest-auth-example:*';

/**
 * Deletes every Redis key whose name matches `nest-auth-example:*`.
 *
 * Uses `SCAN` with a cursor rather than `KEYS` to avoid blocking the Redis
 * event loop on large key sets. Deleted in pipeline batches of 100.
 *
 * @param redis - Connected `ioredis` client pointing at the test Redis instance.
 * @param pattern - Optional glob pattern override (default: `nest-auth-example:*`).
 */
export async function flushTestKeys(
  redis: Redis,
  pattern: string = TEST_KEY_PATTERN,
): Promise<void> {
  const stream = redis.scanStream({ match: pattern, count: 100 });

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (keys: string[]) => {
      if (keys.length === 0) return;
      void redis.pipeline(keys.map((k) => ['del', k])).exec();
    });

    stream.on('end', () => resolve());
    stream.on('error', (err: Error) => reject(err));
  });
}
