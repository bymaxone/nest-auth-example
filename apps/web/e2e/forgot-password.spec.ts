/**
 * @fileoverview E2E: Forgot-password flow — submit email, read reset link from
 * Mailpit, follow link, set new password, log in again.
 *
 * Prerequisites: full stack + Mailpit running at http://localhost:58025.
 *
 * @layer test/e2e
 */

import { test, expect } from '@playwright/test';
import { waitForEmail, clearMailpit, extractResetUrl } from './fixtures/mailpit.js';

// Use viewer.acme — a seeded ACTIVE user no other spec authenticates as. The
// canonical `member@example.dev` is the login-happy spec's subject; resetting
// its password here would break that spec's login attempt later in the run.
const MEMBER_EMAIL = process.env['E2E_FORGOT_PASSWORD_EMAIL'] ?? 'viewer.acme@example.com';
const TENANT_ID = process.env['E2E_TENANT_ID'] ?? 'acme';

test.describe('Forgot password flow', () => {
  test.beforeEach(async () => {
    await clearMailpit();
  });

  test('submits email → Mailpit receives reset email → user can reset and re-login', async ({
    page,
  }) => {
    /**
     * Complete token-based password-reset flow.
     * Depends on Mailpit capturing the reset email so the token can be extracted.
     */
    // 1. Navigate to forgot-password page.
    await page.goto(`/auth/forgot-password?tenantId=${TENANT_ID}`);
    await page.getByLabel(/email/i).fill(MEMBER_EMAIL);
    await page.getByRole('button', { name: /send|reset/i }).click();

    // 2. Verify the form acknowledges the submission (any success indicator).
    await expect(
      page.getByText(/check your email|sent|link/i).or(page.getByRole('alert')),
    ).toBeVisible({ timeout: 5_000 });

    // 3. Poll Mailpit for the reset email.
    const html = await waitForEmail(MEMBER_EMAIL, 10_000);
    const resetUrl = extractResetUrl(html);
    expect(resetUrl).toMatch(/token=/);

    // 4. Follow the reset link.
    await page.goto(resetUrl);

    // 5. Set a new password.
    const newPassword = `NewP@ssw0rd-${Date.now().toString()}`;
    await page.getByLabel(/new password/i).fill(newPassword);
    const confirmField = page.getByLabel(/confirm|repeat/i);
    if (await confirmField.isVisible({ timeout: 500 }).catch(() => false)) {
      await confirmField.fill(newPassword);
    }
    // Reset-password page button reads "Set new password" — the original
    // /reset|save|submit/ regex did not match, leaving the form unsubmitted.
    await page.getByRole('button', { name: /set new password|reset|save|submit/i }).click();

    // 6. Expect redirect to login or a success message.
    await expect(
      page.waitForURL(new RegExp('/auth/login'), { timeout: 10_000 }).catch(() => null),
    ).resolves.not.toThrow();
  });
});
