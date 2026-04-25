/**
 * @fileoverview E2E: Platform tenants list page.
 *
 * Asserts that after platform login the tenants table renders the two
 * seeded tenants (Acme Corp and Globex Inc) and that row clicks navigate
 * to the users page for the selected tenant.
 *
 * Prerequisites: API + Postgres + Redis running; DB seeded.
 *
 * @layer test/e2e/platform
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const PLATFORM_EMAIL = 'platform@example.dev';
const PLATFORM_PASSWORD = 'PlatformPassw0rd!';

async function loginAsPlatformAdmin(page: Page): Promise<void> {
  await page.goto('/platform/login');
  await page.getByLabel('Email').fill(PLATFORM_EMAIL);
  await page.getByLabel('Password').fill(PLATFORM_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL('/platform/tenants', { timeout: 10_000 });
}

test.describe('Platform tenants page', () => {
  /**
   * Both seeded tenants are listed in the table.
   * Protects: P15-3 — listPlatformTenants() returns data; TenantsTable renders rows.
   */
  test('lists the two seeded tenants', async ({ page }) => {
    await loginAsPlatformAdmin(page);

    await expect(page.getByText('Acme Corp')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Globex Inc')).toBeVisible();
  });

  /**
   * Tenant slug badges are shown for both tenants.
   * Protects: P15-3 — slug column renders correctly.
   */
  test('displays slug badges', async ({ page }) => {
    await loginAsPlatformAdmin(page);

    await expect(page.getByText('acme')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('globex')).toBeVisible();
  });

  /**
   * Clicking "View users" for Acme Corp navigates to /platform/users?tenantId=<id>.
   * Protects: P15-3 — row/action button navigation to the users page works.
   */
  test('navigates to users page when View users is clicked', async ({ page }) => {
    await loginAsPlatformAdmin(page);

    /* Wait for the table to load. */
    await expect(page.getByText('Acme Corp')).toBeVisible({ timeout: 8_000 });

    /* Click the first "View users" button (Acme Corp row). */
    const viewButtons = page.getByRole('button', { name: /view users/i });
    await viewButtons.first().click();

    await expect(page).toHaveURL(/\/platform\/users\?tenantId=/, { timeout: 5_000 });
  });
});
