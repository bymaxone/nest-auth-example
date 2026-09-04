/**
 * @fileoverview E2E: code-based password reset — request a code, follow the
 * confirmation screen's route into the code-entry form, set a new password, and
 * sign in with it.
 *
 * Runs against the second stack rather than the default one, because neither
 * side of this flow can be switched at request time: the API decides between a
 * link and a code from `PASSWORD_RESET_METHOD` at boot, and the web app inlines
 * `NEXT_PUBLIC_PASSWORD_RESET_MODE` into the browser bundle at build time. The
 * `chromium-otp` Playwright project points this file at that stack — see
 * `playwright.config.ts`.
 *
 * What it protects, which the token-mode spec cannot: in code mode the email
 * carries a number and no link, so the confirmation screen is the only way
 * through to the form that accepts it. Without that control the flow dead-ends
 * on "check your inbox", and the build-time flag that renders it can regress
 * without any other test noticing.
 *
 * Prerequisites: full stack + Mailpit running — see `playwright.config.ts`.
 *
 * @layer test/e2e
 */

import { test, expect } from '@playwright/test';
import { waitForEmail, clearMailpit, extractOtp } from './fixtures/mailpit.js';

/**
 * Uses member.globex — the one seeded account no other spec authenticates as.
 * This test changes its password, so sharing a subject with another spec would
 * make the two order-dependent, which is the hazard the token-mode spec calls
 * out for its own choice of viewer.acme.
 */
const RESET_EMAIL = process.env['E2E_OTP_RESET_EMAIL'] ?? 'member.globex@example.com';
const TENANT_ID = process.env['E2E_OTP_TENANT_ID'] ?? 'globex';

test.describe('Password reset — code mode', () => {
  test.beforeEach(async () => {
    await clearMailpit();
  });

  test('requests a code, follows the entry link, resets, and signs in again', async ({ page }) => {
    // 1. Ask for the reset.
    await page.goto(`/auth/forgot-password?tenantId=${TENANT_ID}`);
    await page.getByLabel(/email/i).fill(RESET_EMAIL);
    await page.getByRole('button', { name: /send|reset/i }).click();

    // 2. The confirmation screen must offer a way into the code-entry form.
    //    This control is what the build-time flag renders, and it is the whole
    //    reason this spec needs a stack of its own.
    const enterCode = page.getByRole('link', { name: /enter the code/i });
    await expect(enterCode).toBeVisible({ timeout: 5_000 });

    // 3. Read the code Mailpit captured. In this mode the mail carries a number
    //    and no link, so `extractResetUrl` would find nothing to follow.
    const html = await waitForEmail(RESET_EMAIL, 10_000);
    const otp = extractOtp(html);
    expect(otp).toMatch(/^\d{6}$/);

    // 4. Follow the control rather than navigating by hand — the point is that
    //    it carries the email and tenant through to the next screen.
    await enterCode.click();
    await expect(page).toHaveURL(/mode=otp/);

    // 5. Enter the code and the replacement password.
    const newPassword = `NewP@ssw0rd-${Date.now().toString()}`;
    const otpBoxes = page.locator('input[maxlength="1"]');
    await expect(otpBoxes).toHaveCount(6);
    for (const [index, digit] of [...otp].entries()) {
      await otpBoxes.nth(index).fill(digit);
    }
    await page.getByLabel(/new password/i).fill(newPassword);
    const confirmField = page.getByLabel(/confirm|repeat/i);
    if (await confirmField.isVisible({ timeout: 500 }).catch(() => false)) {
      await confirmField.fill(newPassword);
    }
    await page.getByRole('button', { name: /set new password|reset|save|submit/i }).click();

    // 6. The reset lands on the login screen.
    await page.waitForURL(/\/auth\/login/, { timeout: 10_000 });

    // 7. The replacement password works — which is what proves the code was
    //    actually accepted rather than the form merely navigating away.
    await clearMailpit();
    await page.goto(`/auth/login?tenantId=${TENANT_ID}`);
    await page.getByLabel(/email/i).fill(RESET_EMAIL);
    await page.getByLabel(/password/i).fill(newPassword);
    await page.getByRole('button', { name: /sign in|log in|entrar/i }).click();

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  });
});
