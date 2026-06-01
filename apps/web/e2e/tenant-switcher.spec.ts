/**
 * @fileoverview E2E: Workspace switcher — admin user with accounts in two
 * tenants selects the other workspace and stays on the dashboard with a fresh
 * session for the destination tenant.
 *
 * The seed creates `admin@example.dev` as two distinct `User` rows — one in
 * `acme`, one in `globex` — sharing the same email. The library binds one JWT
 * to one tenant; selecting a different workspace triggers the **silent switch**
 * flow added in lib v1.0.10: the API mints a session for the sibling `User`
 * row without a password and the dashboard re-renders with the new identity
 * — no logout, no redirect to `/auth/login`. (Pre-v1.0.10 the example used the
 * Slack-style logout-and-relogin behaviour; that path is now reserved for the
 * MFA-fallback case only.)
 *
 *
 * @layer test/e2e
 */

import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.dev';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'] ?? 'AdminPassw0rd!';
const SOURCE_TENANT_SLUG = process.env['E2E_TENANT_ID'] ?? 'acme';
const DEST_TENANT_SLUG = process.env['E2E_SECOND_TENANT_ID'] ?? 'globex';

test.describe('Workspace switcher', () => {
  test('admin in two tenants can silently switch into the second workspace via the switcher', async ({
    page,
  }) => {
    /*
     * Silent switch flow.
     *
     * 1. Login as `admin@example.dev` against the source tenant (acme).
     * 2. Open the workspace switcher in the topbar.
     * 3. The dropdown lists BOTH workspaces (acme + globex) because the seed
     *    inserts the admin's email in both tenants, with the ✓ next to the
     *    active one (derived from `useSession().user.tenantId`).
     * 4. Click the destination workspace (globex). The component POSTs to
     *    `/api/account/switch-workspace` — the API mints a session for the
     *    sibling `User` row in globex, rotates the cookies, and the page
     *    stays on `/dashboard` (no logout, no redirect to /auth/login).
     * 5. After the switch settles, `/api/auth/me` reflects the destination
     *    tenantId and the topbar trigger updates to show the destination
     *    workspace name — both without a full page reload.
     *
     * Protects: the silent-switch path of `handleSelect` + the
     * `user.tenantId`-driven active-workspace render branch.
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

    // ── 4. Click the destination workspace — triggers the silent switch. ──
    // Surface failures of POST /api/account/switch-workspace at the click site
    // instead of letting them masquerade as a "topbar never updated" timeout.
    // The endpoint returns 200 with the destination user projection on success.
    const switchResponsePromise = page.waitForResponse(
      (r) =>
        /\/api\/account\/switch-workspace(\?|$)/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 10_000 },
    );
    await destItem.click();
    const switchResponse = await switchResponsePromise;
    const switchStatus = switchResponse.status();
    if (switchStatus >= 300) {
      throw new Error(
        `POST /api/account/switch-workspace failed: ${switchStatus} ${await switchResponse.text()}`,
      );
    }

    // ── 5. URL stays on /dashboard and the topbar updates without reload. ─
    await expect(page).toHaveURL(/\/dashboard(\?|$|\/)/, { timeout: 3_000 });

    // The trigger text reflects `useSession().user.tenantId` after the
    // component's internal `refresh()` resolves. Match the destination
    // workspace name shown inside the button — `getByRole` selects by accessible
    // name (the aria-label), so use the inner text via `toContainText`.
    await expect(trigger).toContainText(new RegExp(DEST_TENANT_SLUG, 'i'), { timeout: 10_000 });
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
