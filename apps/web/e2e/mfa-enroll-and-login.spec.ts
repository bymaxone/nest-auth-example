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
import { authenticator } from 'otplib';

const MEMBER_EMAIL = process.env['E2E_MEMBER_EMAIL'] ?? 'member@example.dev';
const MEMBER_PASSWORD = process.env['E2E_MEMBER_PASSWORD'] ?? 'MemberPassw0rd!';
const TENANT_ID = process.env['E2E_TENANT_ID'] ?? 'acme';

test.describe('MFA enroll and login', () => {
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

    // 3. Start MFA setup.
    await page.getByRole('button', { name: /enable.*mfa|set up.*mfa|configure.*2fa/i }).click();

    // 4. Extract the TOTP secret from the page (from the "manual entry" field
    //    or the data-secret attribute on the QR code wrapper).
    const secretInput = page
      .getByTestId('mfa-secret')
      .or(page.getByLabel(/secret|manual/i))
      .or(page.getByRole('textbox', { name: /secret/i }));

    await expect(secretInput).toBeVisible({ timeout: 5_000 });
    const secret = (await secretInput.inputValue()) || (await secretInput.textContent()) || '';
    expect(secret.length).toBeGreaterThan(0);

    // 5. Generate a valid TOTP code and submit it to confirm MFA setup.
    const code = authenticator.generate(secret);
    const codeInput = page.getByLabel(/code|verification|totp/i).last();
    await codeInput.fill(code);
    await page.getByRole('button', { name: /confirm|verify|enable/i }).click();

    // 6. MFA is now enabled — log out.
    await expect(
      page.getByText(/mfa enabled|two-factor enabled|authenticator app added/i),
    ).toBeVisible({ timeout: 5_000 });
    await page.goto('/auth/logout').catch(() => null);
    await page.goto(`/auth/login?tenantId=${TENANT_ID}`);

    // 7. Log in again — expect MFA challenge.
    await page.getByLabel(/email/i).fill(MEMBER_EMAIL);
    await page.getByLabel(/password/i).fill(MEMBER_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    // 8. Enter the MFA code on the challenge page.
    const challengeInput = page.getByLabel(/code|otp|verification/i);
    await expect(challengeInput).toBeVisible({ timeout: 10_000 });
    await challengeInput.fill(authenticator.generate(secret));
    await page.getByRole('button', { name: /verify|submit|confirm/i }).click();

    // 9. Should land on the dashboard after the challenge.
    await expect(page).toHaveURL('/dashboard', { timeout: 10_000 });
  });
});
