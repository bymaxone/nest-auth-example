/**
 * @file throttle.ts
 * @description Rate-limit helpers for e2e test suites.
 *
 * Every e2e request originates from `127.0.0.1`, so BOTH rate limiters the
 * application runs see one client hammering the auth endpoints:
 *
 * 1. The app-wide `ThrottlerGuard` (`@nestjs/throttler`, in-memory storage)
 *    that enforces the `@Throttle(AUTH_THROTTLE_CONFIGS.*)` decorators the
 *    library places on its controllers (login 5/min, register 10/h, ...).
 * 2. The library's own `AuthRateLimitGuard` — enforced since lib v1.4.x with
 *    `rateLimit: { enabled: true, clientIpSource: 'peer' }` — whose counters
 *    live in Redis under `nest-auth-example:rl:*` and therefore SURVIVE across
 *    spec files in a sequential run against the shared test Redis.
 *
 * Both are correct in production and merely an artefact here: a suite
 * exercising session eviction or account lockout needs more requests than the
 * tiers allow, and a 429 masks the very response it is asserting on.
 *
 * `resetAuthRateLimits` clears both counter stores so a suite can keep going.
 * Reach for it in `beforeEach` (the Redis counters leak in from previous spec
 * files too) and in the rare mid-test spot that legitimately needs more calls
 * than a tier allows — never to paper over a route that should have been
 * throttled. The dedicated throttle-demo suite deliberately does NOT reset
 * mid-test, which is what keeps the guard itself covered.
 *
 * @layer test
 * @see src/health/health.controller.ts
 * @see src/auth/auth.config.ts (rateLimit wiring)
 */

import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import type { TestingModule } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { BYMAX_AUTH_REDIS_CLIENT } from '@bymax-one/nest-auth';

import { flushTestKeys } from './redis.js';

/**
 * Clears every in-memory rate-limit counter held by the application.
 *
 * `ThrottlerModule` is registered exactly once, in `AppModule`, so the storage
 * resolved from the root injector is the same instance the guard writes to. A
 * second `forRoot` anywhere in the tree would stand up a second storage and
 * silently make this a no-op.
 *
 * @param moduleRef - The testing module the application was created from.
 */
export function resetThrottleCounters(moduleRef: TestingModule): void {
  const storage = moduleRef.get<ThrottlerStorageService>(ThrottlerStorage);
  storage.storage.clear();
}

/**
 * Clears BOTH rate-limit counter stores: the in-memory `ThrottlerGuard`
 * storage and the library's Redis-backed `AuthRateLimitGuard` counters
 * (`nest-auth-example:rl:*`).
 *
 * The Redis counters are keyed per route and per HMAC'd client IP, and their
 * fixed windows range from one minute (login) to one hour (register) — long
 * enough that a full sequential e2e run would exhaust them across spec files
 * without this reset. Brute-force lockout counters (`lf:*`) are deliberately
 * NOT touched: specs that need those cleared flush them explicitly.
 *
 * @param moduleRef - The testing module the application was created from.
 */
export async function resetAuthRateLimits(moduleRef: TestingModule): Promise<void> {
  resetThrottleCounters(moduleRef);
  const redis = moduleRef.get<Redis>(BYMAX_AUTH_REDIS_CLIENT);
  await flushTestKeys(redis, 'nest-auth-example:rl:*');
}
