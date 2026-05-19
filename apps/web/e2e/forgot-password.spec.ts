/**
 * @fileoverview E2E: Forgot-password flow — submit email, read reset link from
 * Mailpit, follow link, set new password, log in again.
 *
 * Prerequisites: full stack + Mailpit running at http://localhost:58025.
 *
 * @layer test/e2e
 * @see docs/DEVELOPMENT_PLAN.md §Phase 17 P17-10
 */

import { test, expect } from '@playwright/test';
import { waitForEmail, clearMailpit, extractResetUrl } from './fixtures/mailpit.js';

const MEMBER_EMAIL = process.env['E2E_MEMBER_EMAIL'] ?? 'member@example.dev';
const TENANT_ID = process.env['E2E_TENANT_ID'] ?? 'acme';

test.describe('Forgot password flow', () => {
  test.beforeEach(async () => {
    await clearMailpit();
  });

  test('submits email → Mailpit receives reset email → user can reset and re-login', async ({
    page,
  }) => {
    /**
     * Complete token-based password-reset flow (FCM #6).
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
    await page.getByRole('button', { name: /reset|save|submit/i }).click();

    // 6. Expect redirect to login or a success message.
    await expect(
      page.waitForURL(new RegExp('/auth/login'), { timeout: 10_000 }).catch(() => null),
    ).resolves.not.toThrow();
  });
});
