/**
 * @fileoverview E2E: WebSocket notification per-user isolation.
 *
 * Verifies that `POST /api/debug/notify/self` pushes a notification only to
 * the caller's own open WebSocket sockets — not to any other authenticated user.
 *
 * Two browser contexts are spawned:
 *   - Context A: `member.acme@example.com` — clicks the demo button.
 *   - Context B: `admin.acme@example.com` — waits and asserts no toast arrived.
 *
 * Prerequisites: API + Postgres + Redis running; DB seeded with `pnpm seed`.
 * Both users belong to `acme` tenant and have password `Passw0rd!Passw0rd`.
 * The tenant_id cookie is set automatically by the TenantSwitcher on dashboard load.
 *
 * @layer test/e2e/notifications
 * @see docs/DEVELOPMENT_PLAN.md §Phase 16 P16-3
 */

import { test, expect, type Browser } from '@playwright/test';

/** Seeded member user — all dashboard roles can call notify/self. */
const MEMBER_EMAIL = 'member.acme@example.com';
/** Seeded admin user — used as the "other" context to verify isolation. */
const ADMIN_EMAIL = 'admin.acme@example.com';
/** Shared password for all seeded tenant users (see apps/api/prisma/seed.ts). */
const SEED_PASSWORD = 'Passw0rd!Passw0rd';

/** Acme tenant slug — used to find and set the tenant in the TenantSwitcher. */
const TENANT_SLUG = 'acme';

/**
 * Logs in to the dashboard for the given credentials and navigates to the
 * dashboard home. Waits for the TenantSwitcher to select the acme tenant so
 * the `tenant_id` cookie is set before further navigation.
 *
 * @param browser  - Playwright `Browser` instance.
 * @param email    - User email address.
 * @param password - User password.
 * @returns The new `BrowserContext` with an active dashboard session.
 */
async function loginAs(browser: Browser, email: string, password: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto('/auth/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();

  // Wait for redirect to the dashboard.
  await page.waitForURL(/\/dashboard/, { timeout: 10_000 });

  // The TenantSwitcher fetches tenants on load and sets the tenant_id cookie.
  // Wait until the switcher is visible so the cookie is reliably set.
  await page
    .waitForSelector(`[data-testid="tenant-switcher"], button:has-text("${TENANT_SLUG}")`, {
      timeout: 5_000,
    })
    .catch(() => {
      // TenantSwitcher might not have a testid — just wait for the dashboard to settle.
    });

  return ctx;
}

test.describe('Notifications — per-user isolation', () => {
  test('notify/self delivers toast to Context A but not Context B', async ({ browser }) => {
    /*
     * Scenario: clicking "Send test notification" in Context A (member) fires a
     * WS notification only to that user's own sockets. Context B (admin, same
     * tenant) must see no toast after 3 seconds.
     * Protects: P16-3 — WsJwtGuard + per-userId socket map prevent cross-user leakage.
     */

    // ── Log in both contexts in parallel ─────────────────────────────────────
    const [ctxA, ctxB] = await Promise.all([
      loginAs(browser, MEMBER_EMAIL, SEED_PASSWORD),
      loginAs(browser, ADMIN_EMAIL, SEED_PASSWORD),
    ]);

    const pageA = ctxA.pages()[0]!;
    const pageB = ctxB.pages()[0]!;

    try {
      // ── Context A: navigate to account page ─────────────────────────────────
      await pageA.goto('/dashboard/account');
      await pageA.waitForLoadState('networkidle');

      // ── Context B: stay on dashboard and wait ────────────────────────────────
      await pageB.goto('/dashboard');
      await pageB.waitForLoadState('networkidle');

      // ── Context A: click the demo button ────────────────────────────────────
      const demoButton = pageA.getByRole('button', { name: /send test notification/i });
      await expect(demoButton).toBeVisible({ timeout: 5_000 });
      await demoButton.click();

      // ── Context A: toast must appear within 2 s ─────────────────────────────
      await expect(pageA.getByText('Hello')).toBeVisible({ timeout: 2_000 });

      // ── Context B: no toast must appear within 3 s ──────────────────────────
      await pageB.waitForTimeout(3_000);
      await expect(pageB.getByText('Hello')).not.toBeVisible();
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
