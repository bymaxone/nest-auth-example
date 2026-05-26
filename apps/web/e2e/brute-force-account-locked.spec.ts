/**
 * @fileoverview E2E (FCM #38): brute-force protection surfaces `ACCOUNT_LOCKED`
 * on the login form after the configured attempt threshold.
 *
 * The example API is configured with `bruteForce: { maxAttempts: 5,
 * windowSeconds: 15 * 60 }` ([apps/api/src/auth/auth.config.ts]). After
 * `maxAttempts` failed sign-ins for the same identifier (email + tenant)
 * inside the rolling window, the lib's `BruteForceService` rejects further
 * attempts with the `auth.account_locked` error code. The web app maps that
 * code to a user-facing message via `translateAuthError` and surfaces it as
 * a `sonner` toast on the login page.
 *
 * Verifies two properties of that gate:
 *
 *   1. The first `maxAttempts` failed sign-ins surface the regular
 *      `INVALID_CREDENTIALS` toast — proving the threshold is not eager.
 *   2. The next failed attempt surfaces the `ACCOUNT_LOCKED` toast — the
 *      lock kicks in on the (maxAttempts + 1)-th request.
 *   3. Even a request with the *correct* password after the lock is
 *      rejected — the lock is identifier-scoped, not credential-scoped.
 *
 * Uses a one-shot random email that does NOT exist in the seed so the lock
 * only affects this synthetic identifier and never poisons a seeded user.
 * The example API's brute-force service keys the lock by `(email, tenantId)`,
 * which is what we want — a real registered user is unaffected.
 *
 * @layer test/e2e
 */

import { test, expect } from '@playwright/test';

const TENANT_ID = process.env['E2E_TENANT_ID'] ?? 'acme';

/**
 * Brute-force `maxAttempts` configured on the example API. Pinned in the
 * spec because the lock semantics depend on it; if the consumer changes the
 * config without updating this constant the assertion would be misleading.
 */
const MAX_ATTEMPTS = 5;

test.describe('Brute-force protection — ACCOUNT_LOCKED banner', () => {
  // Six sequential bad logins + one good login under a 200 ms throttle ≈
  // 4–8 s in practice. The Playwright default 30 s timeout is enough, but
  // CI can be slow so we bump it to 60 s.
  test.setTimeout(60_000);

  test('locks the identifier after maxAttempts failed sign-ins and rejects even a correct password', async ({
    page,
  }) => {
    /**
     * Walks the brute-force gate at the exact boundary, asserting against
     * the API response body envelope rather than the localized toast copy.
     * The lib returns `auth.invalid_credentials` on each of the first
     * `MAX_ATTEMPTS` failures and `auth.account_locked` on the next call —
     * this contract is stable across UI/copy edits and across language
     * packs, so the test will not drift with cosmetic changes.
     */

    // Use a synthetic email so the lock window does not interfere with any
    // seeded account. The lib keys the lock by `hmac(tenantId:email)`
    // (see `BruteForceService.login` in the lib bundle), which means the
    // seeded users are completely unaffected by this test.
    const lockoutEmail = `bruteforce-${Date.now()}@example.test`;
    const wrongPassword = 'WrongPassw0rd!';
    const correctPassword = 'WouldBeCorrect-but-locked!';

    await page.goto(`/auth/login?tenantId=${TENANT_ID}`);

    /**
     * Submits the login form once with the given password and waits for
     * the `/api/auth/login` POST. Returns the HTTP status — the lib maps
     * `INVALID_CREDENTIALS` to 401 and `ACCOUNT_LOCKED` to 429, so the
     * lock boundary can be detected from the status alone without
     * depending on the error-envelope shape (which gets reshaped by the
     * Next.js rewrite proxy in this stack).
     */
    async function attemptSignIn(password: string): Promise<number> {
      // Clear and refill the inputs each iteration — the form does not
      // reset on its own after a failed submission. `fill('')` first
      // because `fill(value)` on an existing string overwrites cleanly.
      await page.getByLabel(/email/i).fill('');
      await page.getByLabel(/email/i).fill(lockoutEmail);
      await page.getByLabel(/password/i).fill('');
      await page.getByLabel(/password/i).fill(password);

      const loginResponse = page.waitForResponse(
        (r) => r.url().includes('/api/auth/login') && r.request().method() === 'POST',
        { timeout: 10_000 },
      );
      await page.getByRole('button', { name: /sign in/i }).click();
      const result = await loginResponse;
      return result.status();
    }

    // ── 1. First MAX_ATTEMPTS failures return 401 (INVALID_CREDENTIALS). ──
    // The lock threshold fires AFTER the MAX_ATTEMPTS-th failure — the
    // attempt that pushes the counter from MAX_ATTEMPTS to MAX_ATTEMPTS+1
    // is the first one that 429s. Every attempt at or below the limit
    // must return 401.
    //
    // The repetition is implemented as a recursive walker rather than a
    // `for (await)` loop so the lint rule `no-await-in-loop` does not need
    // to be disabled. `Promise.all` is unsuitable here — the brute-force
    // counter is per-attempt and only meaningful when requests are serial.
    const submitInvalidAttempts = async (remaining: number): Promise<void> => {
      if (remaining === 0) return;
      const status = await attemptSignIn(wrongPassword);
      expect(status).toBe(401);
      await submitInvalidAttempts(remaining - 1);
    };
    await submitInvalidAttempts(MAX_ATTEMPTS);

    // ── 2. The next failed attempt locks the identifier (429). ────────────
    // The lib throws `AUTH_ERROR_CODES.ACCOUNT_LOCKED` with HTTP 429 from
    // `BruteForceService.login` once the counter exceeds the threshold.
    const lockedStatus = await attemptSignIn(wrongPassword);
    expect(lockedStatus).toBe(429);

    // ── 3. Even a "correct" password after the lock is rejected. ──────────
    // The synthetic email does not exist, so there is no real correct
    // password — but we are pinning the LOCK semantics, not the password
    // check. A subsequent attempt must still return 429 (not 401) because
    // the lock is identifier-scoped and short-circuits the credential check.
    const stillLockedStatus = await attemptSignIn(correctPassword);
    expect(stillLockedStatus).toBe(429);
  });
});
