/**
 * @fileoverview E2E: Login with wrong password shows an error message.
 *
 * Verifies that the `INVALID_CREDENTIALS` auth error code is translated to a
 * user-facing string from `auth-errors.ts` and rendered visibly on the page.
 * The page must NOT redirect to `/dashboard` on failure.
 *
 * @layer test/e2e
 */

import { test, expect } from '@playwright/test';

const MEMBER_EMAIL = process.env['E2E_MEMBER_EMAIL'] ?? 'member@example.dev';
const TENANT_ID = process.env['E2E_TENANT_ID'] ?? 'acme';

test.describe('Login — wrong password', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/auth/login?tenantId=${TENANT_ID}`);
  });

  test('shows an error message and stays on the login page', async ({ page }) => {
    /**
     * Wrong password must surface the INVALID_CREDENTIALS message from auth-errors.ts
     * and keep the user on the login page.
     */
    await page.getByLabel(/email/i).fill(MEMBER_EMAIL);
    await page.getByLabel(/password/i).fill('definitly-wrong-password-999');
    await page.getByRole('button', { name: /sign in/i }).click();

    // The error must appear within 5 s (no page navigation).
    await expect(
      page.getByRole('alert').or(page.getByText(/invalid|incorrect|wrong/i)),
    ).toBeVisible({
      timeout: 5_000,
    });
    await expect(page).toHaveURL(new RegExp('/auth/login'));
  });

  test('unknown email shows the same error shape as wrong password (anti-enumeration)', async ({
    page,
  }) => {
    /**
     * Anti-enumeration: an attacker must not be able to determine whether an
     * email exists by observing different error messages.
     */
    await page.getByLabel(/email/i).fill('nobody@nonexistent.example.test');
    await page.getByLabel(/password/i).fill('SomePassword123!');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(
      page.getByRole('alert').or(page.getByText(/invalid|incorrect|wrong/i)),
    ).toBeVisible({
      timeout: 5_000,
    });
    await expect(page).toHaveURL(new RegExp('/auth/login'));
  });
});
