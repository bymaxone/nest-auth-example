/**
 * @fileoverview E2E: Happy-path tenant user login.
 *
 * Exercises the `/auth/login` page: submits valid credentials for a seeded
 * tenant member and asserts the redirect lands on `/dashboard`.
 *
 * Prerequisites: full stack running (`pnpm infra:up` + API + web dev server).
 *
 * @layer test/e2e
 * @see docs/DEVELOPMENT_PLAN.md §Phase 17 P17-10
 */

import { test, expect } from '@playwright/test';

/** Seeded tenant member credentials — see `apps/api/prisma/seed.ts`. */
const MEMBER_EMAIL = process.env['E2E_MEMBER_EMAIL'] ?? 'member@example.dev';
const MEMBER_PASSWORD = process.env['E2E_MEMBER_PASSWORD'] ?? 'MemberPassw0rd!';
const TENANT_ID = process.env['E2E_TENANT_ID'] ?? 'acme';

test.describe('Login — happy path', () => {
  test.beforeEach(async ({ page }) => {
    /**
     * Navigate to the login page with the tenant ID in the URL search params
     * so the page pre-fills or sets the X-Tenant-Id header correctly.
     */
    await page.goto(`/auth/login?tenantId=${TENANT_ID}`);
  });

  test('logs in with valid credentials and redirects to /dashboard', async ({ page }) => {
    /**
     * Submit canonical seeded member credentials and expect a redirect to /dashboard.
     * Protects the register → verify → login → dashboard flow (FCM #2).
     */
    await page.getByLabel(/email/i).fill(MEMBER_EMAIL);
    await page.getByLabel(/password/i).fill(MEMBER_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL('/dashboard', { timeout: 15_000 });
  });

  test('dashboard renders the authenticated user email or name after login', async ({ page }) => {
    /**
     * After a successful login the dashboard must display the user's identity
     * (name or email), proving the session is actually populated (FCM #29).
     */
    await page.getByLabel(/email/i).fill(MEMBER_EMAIL);
    await page.getByLabel(/password/i).fill(MEMBER_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('/dashboard', { timeout: 15_000 });

    // The dashboard must show either the email or name from the JWT payload.
    const content = await page.content();
    expect(content.toLowerCase()).toMatch(
      new RegExp(MEMBER_EMAIL.toLowerCase().split('@')[0] ?? ''),
    );
  });
});
