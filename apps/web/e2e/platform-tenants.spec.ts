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

import { test, expect } from './fixtures/auth.js';

test.describe('Platform tenants page', () => {
  /**
   * Both seeded tenants are listed in the table.
   * Protects: the tenants list page fetches and displays all tenants for an authenticated platform admin.
   */
  test('lists the two seeded tenants', async ({ platformAdminPage: page }) => {
    await page.goto('/platform/tenants');

    await expect(page.getByText('Acme Corp')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Globex Inc')).toBeVisible();
  });

  /**
   * Tenant slug badges are shown for both tenants.
   * Protects: the tenants list page displays the slug badge for each tenant row.
   */
  test('displays slug badges', async ({ platformAdminPage: page }) => {
    await page.goto('/platform/tenants');

    // `exact: true` is required because the substring "acme" appears in both
    // the slug badge and the tenant-name cell ("Acme Corp"); same for "globex".
    await expect(page.getByText('acme', { exact: true })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('globex', { exact: true })).toBeVisible();
  });

  /**
   * Clicking "View users" for Acme Corp navigates to /platform/users?tenantId=<id>.
   * Protects: the tenants list page allows navigation to the users page for a selected tenant.
   */
  test('navigates to users page when View users is clicked', async ({
    platformAdminPage: page,
  }) => {
    await page.goto('/platform/tenants');

    /* Wait for the table to load. */
    await expect(page.getByText('Acme Corp')).toBeVisible({ timeout: 8_000 });

    /* Click the first "View users" button (Acme Corp row). */
    const viewButtons = page.getByRole('button', { name: /view users/i });
    await viewButtons.first().click();

    await expect(page).toHaveURL(/\/platform\/users\?tenantId=/, { timeout: 5_000 });
  });
});
