/**
 * @file throttle.ts
 * @description Rate-limit helper for e2e test suites.
 *
 * Every e2e request originates from `127.0.0.1`, so the app-wide
 * `ThrottlerGuard` sees one client hammering the auth endpoints and starts
 * answering 429 after the `login` tier's 5 requests per 60 s. That is correct
 * in production and merely an artefact here: a suite exercising session
 * eviction or account lockout needs more than five logins, and a 429 masks the
 * very response it is asserting on.
 *
 * `resetThrottleCounters` clears the in-memory counters so a suite can keep
 * going. Reach for it in the test that legitimately needs more calls than the
 * tier allows — never to paper over a route that should have been throttled.
 * The dedicated throttle-demo suite deliberately does NOT reset mid-test,
 * which is what keeps the guard itself covered.
 *
 * @layer test
 * @see src/health/health.controller.ts
 */

import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import type { TestingModule } from '@nestjs/testing';

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
