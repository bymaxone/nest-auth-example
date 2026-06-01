/**
 * @fileoverview Logout button and RBAC navigation visibility end-to-end spec.
 *
 * Exercises two concerns that share the same UI surface:
 *
 *   1. RBAC nav visibility — the sidebar hides the `Team` and `Invitations`
 *      items for `MEMBER` and `VIEWER` roles, and shows them for `ADMIN`
 *      and `OWNER`. The component does the gating client-side from
 *      `useSession().user.role`; this spec confirms the visible DOM matches.
 *
 *   2. Logout button — the topbar's `Sign out` button must clear cookies and
 *      bounce the user to `/auth/login` via the proxy's redirect chain
 *      (`/api/auth/logout` invalidates the session → `router.refresh()` →
 *      the auth proxy denies the unauthenticated request on `/dashboard`).
 *
 * The two flows are tested independently with two distinct seeded users so
 * a failure on one branch is unambiguous (no cross-contamination between
 * `VIEWER` and `ADMIN` runs).
 *
 * @layer test/e2e
 */

import { test, expect } from '@playwright/test';

// Users dedicated to this spec — picked from the `globex` tenant so the
// password-mutating `forgot-password.spec.ts` (which targets `viewer.acme`)
// cannot poison the login here. `admin.globex` is also untouched by other
// running specs (the `password-reset-otp.spec.ts` test that names it is
// env-gated and only runs in OTP mode).
const VIEWER_EMAIL = process.env['E2E_VIEWER_EMAIL'] ?? 'viewer.globex@example.com';
const VIEWER_PASSWORD = process.env['E2E_VIEWER_PASSWORD'] ?? 'Passw0rd!Passw0rd';
const ADMIN_EMAIL = process.env['E2E_ADMIN_NAV_EMAIL'] ?? 'admin.globex@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_NAV_PASSWORD'] ?? 'Passw0rd!Passw0rd';
const TENANT_ID = process.env['E2E_TENANT_ID'] ?? 'globex';

test.describe('Logout button + RBAC nav visibility', () => {
  test('hides Team and Invitations from a VIEWER, and the Sign out button returns to login', async ({
    page,
  }) => {
    /**
     * Verifies the negative side of the RBAC nav: a low-privilege role must
     * not see admin-only items. Also exercises the logout button — the
     * cleanest end-to-end check that the session actually invalidates is
     * confirming the proxy bounces the user back to `/auth/login` on the
     * next protected route access.
     */
    // ── Sign in as VIEWER ──────────────────────────────────────────────────
    await page.goto(`/auth/login?tenantId=${TENANT_ID}`);
    await page.getByLabel(/email/i).fill(VIEWER_EMAIL);
    await page.getByLabel(/password/i).fill(VIEWER_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('/dashboard', { timeout: 15_000 });

    // ── Public nav items must be visible ──────────────────────────────────
    // The sidebar carries Overview / Account / Security / Sessions / Projects
    // for every role. Pin two of them so a regression that empties the nav
    // (e.g. failed `useSession()` call) is caught loud.
    const sidebar = page.getByRole('navigation', { name: /main navigation/i });
    await expect(sidebar.getByRole('link', { name: /overview/i })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: /security/i })).toBeVisible();

    // ── Admin-only items must NOT be visible for a VIEWER ─────────────────
    // The component literally does not render them; assert count === 0
    // rather than `not.toBeVisible()` so a render that mistakenly hides them
    // with CSS (still in the DOM) would fail.
    await expect(sidebar.getByRole('link', { name: /^team$/i })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: /^invitations$/i })).toHaveCount(0);

    // ── Click the Sign out button in the topbar ───────────────────────────
    // The button is a ghost-styled `<button>` with the literal text "Sign out".
    // It triggers `POST /api/auth/logout` + `router.refresh()` — the proxy
    // sees no valid access cookie on the refresh and redirects to /auth/login.
    await page.getByRole('button', { name: /^sign out$/i }).click();
    await page.waitForURL(/\/auth\/login/, { timeout: 10_000 });

    // ── Verify the session is truly invalidated ──────────────────────────
    // A direct navigation back to /dashboard must NOT serve the dashboard —
    // the proxy must redirect to /auth/login again. This guards against the
    // logout handler clearing only the client state without invalidating
    // the cookies.
    await page.goto('/dashboard');
    await page.waitForURL(/\/auth\/login/, { timeout: 10_000 });
  });

  test('shows Team and Invitations to an ADMIN', async ({ page }) => {
    /**
     * Verifies the positive side of the RBAC nav. Uses `admin.acme` (the
     * canonical seeded ADMIN per tenant). A regression that drops
     * admin-only items for any logged-in user — e.g. the `adminOnly` flag
     * misnamed in the nav config — would fail this test.
     */
    // ── Sign in as ADMIN ───────────────────────────────────────────────────
    await page.goto(`/auth/login?tenantId=${TENANT_ID}`);
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('/dashboard', { timeout: 15_000 });

    const sidebar = page.getByRole('navigation', { name: /main navigation/i });
    await expect(sidebar.getByRole('link', { name: /^team$/i })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: /^invitations$/i })).toBeVisible();

    // The team link must navigate to the team page (clicking it should not
    // bounce off the proxy because ADMIN is in the allowed-roles list).
    await sidebar.getByRole('link', { name: /^team$/i }).click();
    await page.waitForURL('/dashboard/team', { timeout: 10_000 });
  });
});
