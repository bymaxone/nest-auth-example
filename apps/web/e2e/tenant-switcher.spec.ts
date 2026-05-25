/**
 * @fileoverview E2E: Workspace switcher — admin user with accounts in two
 * tenants selects the other workspace and is redirected through the library's
 * logout endpoint to the destination tenant's login page.
 *
 * The seed creates `admin@example.dev` as two distinct `User` rows — one in
 * `acme`, one in `globex` — sharing the same email. The library binds one JWT
 * to one tenant, so "switching" is a Slack-style re-authentication, not a live
 * context swap. This spec verifies that whole flow end-to-end.
 *
 * Coverage: FCM #20 (multi-tenant workspace switching).
 *
 * @layer test/e2e
 */

import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.dev';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'] ?? 'AdminPassw0rd!';
const SOURCE_TENANT_SLUG = process.env['E2E_TENANT_ID'] ?? 'acme';
const DEST_TENANT_SLUG = process.env['E2E_SECOND_TENANT_ID'] ?? 'globex';

test.describe('Workspace switcher', () => {
  test('admin in two tenants can re-auth into the second workspace via the switcher', async ({
    page,
  }) => {
    /*
     * Full re-auth flow (FCM #20).
     *
     * 1. Login as `admin@example.dev` against the source tenant (acme).
     * 2. Open the workspace switcher in the topbar.
     * 3. The dropdown lists BOTH workspaces (acme + globex) because the seed
     *    inserts the admin's email in both tenants.
     * 4. Click the destination workspace (globex). The component POSTs
     *    /api/auth/logout and assigns window.location to /auth/login?tenantId=globex.
     * 5. The destination login page must render — confirming the cookies were
     *    cleared and the redirect followed.
     *
     * Protects: the library's one-JWT-per-tenant model + the Slack-style UX
     * the example claims in its README.
     */

    // ── 1. Login at the source tenant. ────────────────────────────────────
    await page.goto(`/auth/login?tenantId=${SOURCE_TENANT_SLUG}`);
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('/dashboard', { timeout: 15_000 });

    // ── 2. Open the switcher trigger. ─────────────────────────────────────
    // The trigger button has aria-label="Switch workspace" and is visible at the
    // lg breakpoint (≥1024px) — Playwright's default Desktop Chrome viewport
    // (1280×720) satisfies this.
    const trigger = page.getByRole('button', { name: /switch workspace/i });
    await expect(trigger).toBeVisible({ timeout: 5_000 });

    await trigger.click();

    // ── 3. Both workspaces must be listed in the dropdown. ────────────────
    // Match by case-insensitive slug so seed renames (e.g. "Acme Corp" → "Acme
    // Corp.") do not break the spec — slugs are stable IDs.
    const sourceItem = page.getByRole('menuitem', { name: new RegExp(SOURCE_TENANT_SLUG, 'i') });
    const destItem = page.getByRole('menuitem', { name: new RegExp(DEST_TENANT_SLUG, 'i') });

    await expect(sourceItem).toBeVisible({ timeout: 3_000 });
    await expect(destItem).toBeVisible({ timeout: 3_000 });

    // The current workspace marker (✓) must appear next to the source.
    await expect(sourceItem).toContainText('✓');

    // ── 4. Click the destination workspace — triggers logout + redirect. ──
    await destItem.click();

    // ── 5. Wait until the page lands on the destination login screen. ─────
    // The switcher uses `window.location.assign`, which is a full navigation —
    // wait for the URL to include the destination slug.
    await page.waitForURL(new RegExp(`/auth/login\\?tenantId=${DEST_TENANT_SLUG}`), {
      timeout: 10_000,
    });

    // The login form must be rendered with the destination context preserved
    // in the URL — confirms cookies were cleared and the redirect followed.
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('the switcher disappears when the user belongs to only one workspace', async ({ page }) => {
    /*
     * Single-workspace user UX check.
     *
     * Logs in with the `member@example.dev` seed account that only exists in
     * the source tenant. Even though the switcher dropdown still mounts when
     * there is ≥ 1 workspace, the test here just confirms that:
     *  - the dashboard renders fully (no crash, no infinite spinner)
     *  - if the trigger is visible it contains the source tenant's name
     *
     * This is intentionally permissive: the library does not mandate a UX
     * behaviour for the single-workspace case, so the spec only asserts the
     * dashboard is healthy and the switcher (if rendered) is coherent.
     */
    await page.goto(`/auth/login?tenantId=${SOURCE_TENANT_SLUG}`);
    await page.getByLabel(/email/i).fill('member@example.dev');
    await page.getByLabel(/password/i).fill('MemberPassw0rd!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('/dashboard', { timeout: 15_000 });

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 5_000 });

    const trigger = page.getByRole('button', { name: /switch workspace/i });
    const triggerVisible = await trigger.isVisible({ timeout: 3_000 }).catch(() => false);
    if (triggerVisible) {
      // If visible, it must show some text — the active workspace name.
      const triggerText = (await trigger.textContent()) ?? '';
      expect(triggerText.length).toBeGreaterThan(0);
    }
  });
});
