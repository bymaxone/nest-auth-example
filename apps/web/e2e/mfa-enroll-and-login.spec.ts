/**
 * @fileoverview E2E: MFA enroll → login with TOTP challenge.
 *
 * Exercises the full MFA setup flow from the dashboard security page:
 * enables TOTP, verifies the challenge on the next login, and confirms
 * the dashboard is accessible afterwards.
 *
 * Uses `otplib` to generate a valid TOTP code from the displayed secret.
 *
 * @layer test/e2e
 * @see docs/DEVELOPMENT_PLAN.md §Phase 17 P17-10
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { authenticator } from 'otplib';

// Use owner.acme — a seeded ACTIVE user dedicated to MFA enrollment so that
// `member@example.dev` (login-happy's subject) stays MFA-free. The seed
// resets `mfaEnabled`/`mfaSecret`/`mfaRecoveryCodes` on every run, so this
// user is reliably back to a clean state at the start of each suite.
const MEMBER_EMAIL = process.env['E2E_MFA_EMAIL'] ?? 'owner.acme@example.com';
const MEMBER_PASSWORD = process.env['E2E_MFA_PASSWORD'] ?? 'Passw0rd!Passw0rd';
const TENANT_ID = process.env['E2E_TENANT_ID'] ?? 'acme';

/**
 * Fills the 6-box OtpInput by focusing the first box and typing each digit
 * via the keyboard. Using `keyboard.type` (instead of per-box `.fill`)
 * mirrors a real user typing — each keystroke fires onChange, the component
 * auto-advances focus, and React's controlled state stays in sync with the
 * visible inputs between strokes.
 */
async function fillOtp(page: Page, code: string): Promise<void> {
  await page.locator('input[inputmode="numeric"]').first().click();
  await page.keyboard.type(code, { delay: 30 });
}

test.describe('MFA enroll and login', () => {
  // Per-test timeout bumped to 90 s — the spec deliberately waits up to one
  // full TOTP step (30 s) between enrollment and the re-login challenge so the
  // library's 90 s anti-replay guard (`verifyTotpWithAntiReplay`) does not
  // reject the second submission of the same code. Default Playwright test
  // timeout is 30 s and would fire mid-wait.
  test.setTimeout(90_000);

  test('enrolls MFA from security page and passes TOTP challenge on next login', async ({
    page,
  }) => {
    /**
     * Full MFA enrollment + login challenge flow (FCM #8, #9).
     * The TOTP secret is extracted from the QR page so otplib can generate a
     * valid code without hardcoding any secret.
     */
    // 1. Log in first (no MFA yet).
    await page.goto(`/auth/login?tenantId=${TENANT_ID}`);
    await page.getByLabel(/email/i).fill(MEMBER_EMAIL);
    await page.getByLabel(/password/i).fill(MEMBER_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('/dashboard', { timeout: 15_000 });

    // 2. Navigate to the security/MFA settings page.
    await page.goto('/dashboard/security');

    // 3. Start MFA setup. The button reads "Set up authenticator" (no "MFA"
    //    or "2FA" substring), so the regex must include that phrase.
    await page
      .getByRole('button', { name: /set up authenticator|enable.*mfa|configure.*2fa/i })
      .click();

    // 4. Extract the TOTP secret from the readonly Input (data-testid added to
    //    the component because the shadcn Label has no htmlFor association).
    const secretInput = page.getByTestId('mfa-secret');
    await expect(secretInput).toBeVisible({ timeout: 5_000 });
    const secret = await secretInput.inputValue();
    expect(secret.length).toBeGreaterThan(0);

    // 5. Generate a valid TOTP code and submit it to confirm MFA setup.
    await fillOtp(page, authenticator.generate(secret));
    await page.getByRole('button', { name: /verify.*enable|confirm|enable/i }).click();

    // 6. MFA enable success surfaces as the "Save your recovery codes" modal.
    await expect(page.getByText(/save your recovery codes/i)).toBeVisible({ timeout: 5_000 });
    // Dismiss the modal so logout navigation isn't blocked by the dialog.
    await page.getByRole('button', { name: /saved my codes/i }).click();
    // Properly invalidate the session — `page.goto('/auth/logout')` issues a
    // GET to a path with no page route (404). Without a real logout the
    // proxy's `publicRoutesRedirectIfAuthenticated` would bounce the next
    // `/auth/login` visit back to `/dashboard` and the MFA challenge would
    // never render.
    await page.request.post('/api/auth/logout').catch(() => null);
    await page.context().clearCookies();
    await page.goto(`/auth/login?tenantId=${TENANT_ID}`);

    // 7. Log in again — expect MFA challenge.
    await page.getByLabel(/email/i).fill(MEMBER_EMAIL);
    await page.getByLabel(/password/i).fill(MEMBER_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    // 8. Enter the MFA code on the challenge page.
    await page.waitForURL(/\/auth\/mfa-challenge/, { timeout: 10_000 });
    // The library rejects re-submission of any TOTP code for 90 s (anti-replay
    // guard). The enrollment step at line 65 already consumed the current
    // window's code, so we must wait for the next 30-s TOTP window to roll
    // before generating a fresh code. `(30 - (now % 30) + 1) * 1000` waits
    // until just after the new step boundary — the `+1 s` covers clock skew
    // between the test runner and the API process.
    const msUntilNextStep = (30 - (Math.floor(Date.now() / 1000) % 30) + 1) * 1000;
    await page.waitForTimeout(msUntilNextStep);
    await fillOtp(page, authenticator.generate(secret));
    const challengeResponse = page.waitForResponse(
      (r) => r.url().includes('/api/auth/mfa/challenge') && r.request().method() === 'POST',
      { timeout: 10_000 },
    );
    await page.getByRole('button', { name: /verify|submit|confirm/i }).click();
    const challengeResult = await challengeResponse;
    if (challengeResult.status() >= 300) {
      throw new Error(
        `MFA challenge failed: ${challengeResult.status()} ${await challengeResult.text()}`,
      );
    }

    // 9. Should land on the dashboard after the challenge.
    await expect(page).toHaveURL('/dashboard', { timeout: 10_000 });
  });
});
