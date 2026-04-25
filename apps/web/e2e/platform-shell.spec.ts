/**
 * @fileoverview E2E: Platform admin shell (layout) visibility.
 *
 * Asserts the visually-distinct "PLATFORM ADMIN" header is rendered
 * after login, and that the sidebar nav items are present.
 *
 * Prerequisites: API + Postgres + Redis running; DB seeded.
 *
 * @layer test/e2e/platform
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const PLATFORM_EMAIL = 'platform@example.dev';
const PLATFORM_PASSWORD = 'PlatformPassw0rd!';

/**
 * Helper: log in as the canonical platform admin and land on /platform/tenants.
 */
async function loginAsPlatformAdmin(page: Page): Promise<void> {
  await page.goto('/platform/login');
  await page.getByLabel('Email').fill(PLATFORM_EMAIL);
  await page.getByLabel('Password').fill(PLATFORM_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL('/platform/tenants', { timeout: 10_000 });
}

test.describe('Platform shell', () => {
  /**
   * PLATFORM ADMIN badge is visible in the topbar after login.
   * Protects: P15-2 — platform-topbar.tsx renders the "PLATFORM ADMIN" label.
   */
  test('shows PLATFORM ADMIN header after login', async ({ page }) => {
    await loginAsPlatformAdmin(page);

    await expect(page.getByText('PLATFORM ADMIN')).toBeVisible();
  });

  /**
   * Sidebar contains Tenants and Users navigation links.
   * Protects: P15-2 — platform-sidebar.tsx nav items present.
   */
  test('renders Tenants and Users sidebar links', async ({ page }) => {
    await loginAsPlatformAdmin(page);

    await expect(page.getByRole('link', { name: /tenants/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /users/i })).toBeVisible();
  });

  /**
   * Visiting /platform/tenants without a session redirects to /platform/login.
   * Protects: P15-2 — platform-shell.tsx guards bearer token on mount.
   */
  test('redirects to /platform/login when not authenticated', async ({ page }) => {
    await page.goto('/platform/tenants');
    await expect(page).toHaveURL('/platform/login', { timeout: 5_000 });
  });
});
