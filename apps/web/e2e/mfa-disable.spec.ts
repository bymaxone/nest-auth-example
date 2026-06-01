/**
 * @fileoverview E2E: MFA disable via the dashboard security UI.
 *
 * Mirrors `mfa-enroll-and-login.spec.ts` for the inverse transition — enrolls
 * MFA inline (so the test is self-contained against a clean seeded user),
 * then exercises the disable card on `/dashboard/security`. Confirms the
 * disable round-trip:
 *
 *   1. The "Disable two-factor authentication" button reveals the OTP form.
 *   2. A valid TOTP is accepted by `POST /api/auth/mfa/disable`.
 *   3. After the success toast, the dashboard reverts to the setup card,
 *      proving the persisted `mfaEnabled` flag flipped back to false.
 *
 * Uses `owner.globex@example.com` because the existing MFA enroll spec
 * already claims `owner.acme@example.com` — running both in the same
 * Playwright session would leave that user with MFA already on at the
 * moment this spec attempts to enroll.
 *
 * @layer test/e2e
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { authenticator } from 'otplib';

/**
 * Seeded ACTIVE owner in the `globex` tenant — dedicated to this spec so the
 * other MFA spec (which targets `owner.acme`) is never racing for the same
 * persisted state. The seed resets `mfaEnabled` / `mfaSecret` / `mfaRecoveryCodes`
 * on every Playwright invocation, so this user is reliably clean at suite start.
 */
const MFA_EMAIL = process.env['E2E_MFA_DISABLE_EMAIL'] ?? 'owner.globex@example.com';
const MFA_PASSWORD = process.env['E2E_MFA_DISABLE_PASSWORD'] ?? 'Passw0rd!Passw0rd';
const TENANT_ID = process.env['E2E_MFA_DISABLE_TENANT'] ?? 'globex';

/** Length of a single TOTP step in seconds (RFC 6238 default). */
const TOTP_STEP_SECONDS = 30;

/**
 * Types the 6-digit code into the keyboard-driven `OtpInput`. The component
 * auto-advances focus on each keystroke, so `page.keyboard.type` keeps the
 * controlled React state in sync between strokes.
 */
async function fillOtp(page: Page, code: string): Promise<void> {
  await page.locator('input[inputmode="numeric"]').first().click();
  await page.keyboard.type(code, { delay: 30 });
}

/**
 * Waits until the next TOTP step boundary (plus a small safety margin) so a
 * freshly-generated code cannot collide with a code the lib's anti-replay
 * guard has already accepted in the previous step. Used between the enroll
 * submit and the disable submit.
 */
async function waitForNextTotpStep(page: Page): Promise<void> {
  const msUntilNextStep =
    (TOTP_STEP_SECONDS - (Math.floor(Date.now() / 1000) % TOTP_STEP_SECONDS) + 1) * 1000;
  await page.waitForTimeout(msUntilNextStep);
}

test.describe('MFA disable via UI', () => {
  // Two TOTP steps (~60s) plus the usual UI/network slack — Playwright's
  // 30s default would fire during the inter-step wait.
  test.setTimeout(120_000);

  test('enrolls MFA from the security page, then disables it with a valid TOTP', async ({
    page,
  }) => {
    /**
     * Full enroll → disable lifecycle on the dashboard UI
     * to the mfa-disable lib e2e spec). The test enrolls first so it does not
     * depend on any other spec leaving state behind — Playwright runs files
     * serially with `workers: 1` but the test is self-contained either way.
     */

    // ── 1. Log in (no MFA yet). ────────────────────────────────────────────
    await page.goto(`/auth/login?tenantId=${TENANT_ID}`);
    await page.getByLabel(/email/i).fill(MFA_EMAIL);
    await page.getByLabel(/password/i).fill(MFA_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('/dashboard', { timeout: 15_000 });

    // ── 2. Navigate to the security page and start MFA setup. ──────────────
    await page.goto('/dashboard/security');
    await page
      .getByRole('button', { name: /set up authenticator|enable.*mfa|configure.*2fa/i })
      .click();

    // ── 3. Capture the TOTP secret so `otplib` can generate a valid code. ──
    const secretInput = page.getByTestId('mfa-secret');
    await expect(secretInput).toBeVisible({ timeout: 5_000 });
    const secret = await secretInput.inputValue();
    expect(secret.length).toBeGreaterThan(0);

    // ── 4. Submit the enrollment code. ─────────────────────────────────────
    await fillOtp(page, authenticator.generate(secret));
    await page.getByRole('button', { name: /verify.*enable|confirm|enable/i }).click();

    // Recovery-codes modal confirms enrollment succeeded. Dismiss so the
    // page is interactive again for the disable step.
    await expect(page.getByText(/save your recovery codes/i)).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /saved my codes/i }).click();

    // ── 5. Wait for the next TOTP step. ────────────────────────────────────
    // The lib's anti-replay guard rejects re-submission of any TOTP value for
    // 90 s, so the disable code must come from a fresh step.
    await waitForNextTotpStep(page);

    // ── 6. Open the disable form on the security page. ─────────────────────
    // The page now shows the `MfaDisableCard` because the user has MFA
    // enabled. The security page's `onEnabled` callback calls the lib's
    // `useSession().refresh()` which re-issues `GET /api/auth/me`, picks
    // up the just-persisted `mfaEnabled: true`, and swaps the rendered
    // card. Playwright's auto-wait on the next locator holds until that
    // card transition completes — no manual reload required.
    await page.getByRole('button', { name: /disable two-factor authentication/i }).click();

    // ── 7. Submit a fresh TOTP and confirm. ────────────────────────────────
    await fillOtp(page, authenticator.generate(secret));

    // Wait for the actual mfa/disable POST so we can assert it succeeded
    // before the UI reacts — otherwise a stale page query could pass even on
    // an HTTP 4xx (the toast appears briefly either way).
    const disableResponse = page.waitForResponse(
      (r) => r.url().includes('/api/auth/mfa/disable') && r.request().method() === 'POST',
      { timeout: 10_000 },
    );
    await page.getByRole('button', { name: /confirm disable/i }).click();
    const disableResult = await disableResponse;
    expect(disableResult.status()).toBeLessThan(300);

    // ── 8. Assert MFA is now off. ──────────────────────────────────────────
    // The page re-renders the setup card once `mfaEnabled` flips back to
    // false. The `onDisabled` callback in the security page calls the
    // lib's `useSession().refresh()` which re-fetches `GET /api/auth/me`
    // and updates the `AuthProvider` state in place. Playwright's
    // auto-wait holds the `toBeVisible` assertion until the card
    // transition completes — no manual reload required.
    await expect(page.getByRole('button', { name: /set up authenticator/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole('button', { name: /disable two-factor authentication/i }),
    ).toHaveCount(0);

    // ── 9. Sanity check: /me reflects the persisted state. ─────────────────
    // The auth client refetches /me after the disable flow completes; this
    // request confirms the server view matches the UI assertions above. It
    // also doubles as a regression guard against a UI that flips its local
    // state without persisting (mock-only success).
    const meResp = await page.request.get('/api/auth/me');
    expect(meResp.status()).toBe(200);
    const me = (await meResp.json()) as { mfaEnabled?: boolean };
    expect(me.mfaEnabled).toBe(false);
  });
});
