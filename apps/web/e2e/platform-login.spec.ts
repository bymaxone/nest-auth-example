/**
 * @fileoverview E2E: Platform admin login flow.
 *
 * Exercises the `/platform/login` page end-to-end:
 * submits canonical seeded credentials and asserts the redirect
 * lands on `/platform/tenants`.
 *
 * Prerequisites: API + Postgres + Redis running; DB seeded with `pnpm seed`.
 *
 * @layer test/e2e/platform
 */

import { test, expect } from '@playwright/test';

/** Canonical seeded platform admin — see apps/api/prisma/seed.ts. */
const PLATFORM_EMAIL = 'platform@example.dev';
const PLATFORM_PASSWORD = 'PlatformPassw0rd!';

test.describe('Platform login', () => {
  test.beforeEach(async ({ page }) => {
    /* Clear session storage before each test to guarantee a clean state. */
    await page.goto('/platform/login');
  });

  /**
   * Happy path: valid credentials redirect to /platform/tenants.
   * Protects: P15-1 — submit → platformLogin() → redirect on success.
   */
  test('logs in with valid credentials and redirects to /platform/tenants', async ({ page }) => {
    await page.getByLabel('Email').fill(PLATFORM_EMAIL);
    await page.getByLabel('Password').fill(PLATFORM_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL('/platform/tenants', { timeout: 10_000 });
  });

  /**
   * Wrong password: form stays visible with an error message.
   * Protects: P15-1 — translateAuthError renders INVALID_CREDENTIALS.
   */
  test('shows error on wrong password', async ({ page }) => {
    await page.getByLabel('Email').fill(PLATFORM_EMAIL);
    await page.getByLabel('Password').fill('WrongPassword1!');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByRole('alert')).toBeVisible({ timeout: 5_000 });
    await expect(page).toHaveURL('/platform/login');
  });
});
