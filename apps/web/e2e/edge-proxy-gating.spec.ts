/**
 * @fileoverview E2E (FCM #40): Next.js edge proxy gating — public routes
 * vs protected routes vs role-gated routes.
 *
 * Verifies the three classes of routes declared in `apps/web/proxy.ts`:
 *
 *   1. `publicRoutes` (e.g. `/auth/login`, `/auth/forgot-password`) — load
 *      anonymously without redirecting.
 *   2. `protectedRoutes` catch-all (`/dashboard/:path*`) — unauthenticated
 *      access is redirected to `/auth/login`.
 *   3. Role-gated `protectedRoutes` (`/dashboard/team/:path*` — OWNER /
 *      ADMIN only) — authenticated users with a lower role are redirected
 *      to `/auth/login` (the proxy's role denial branch).
 *
 * Tests the proxy in isolation — no API behavior is asserted beyond the
 * cookie-driven gating chain. The role-gated leg uses a MEMBER (one rung
 * below ADMIN) to prove the gate fires even when the user is otherwise
 * authenticated.
 *
 * @layer test/e2e
 */

import { test, expect } from '@playwright/test';

const MEMBER_EMAIL = process.env['E2E_MEMBER_EMAIL'] ?? 'member@example.dev';
const MEMBER_PASSWORD = process.env['E2E_MEMBER_PASSWORD'] ?? 'MemberPassw0rd!';
const TENANT_ID = process.env['E2E_TENANT_ID'] ?? 'acme';

test.describe('Edge proxy gating', () => {
  test('public auth routes load anonymously without redirect', async ({ page }) => {
    /**
     * Verifies the proxy's `publicRoutes` allowlist. A regression that
     * accidentally drops `/auth/login` or `/auth/forgot-password` from the
     * list would loop the page (redirect to /auth/login indefinitely) or
     * 404 — both caught by the URL assertions below.
     */
    // Ensure the test starts from a clean unauthenticated context so the
    // proxy is forced through the public-route branch.
    await page.context().clearCookies();

    await page.goto('/auth/login');
    await expect(page).toHaveURL(/\/auth\/login/);
    // The login form's submit button is the cheapest "page rendered" check —
    // it is rendered by the React tree, not the proxy, so it proves the page
    // shell actually loaded after the proxy passed the request through.
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();

    await page.goto('/auth/forgot-password');
    await expect(page).toHaveURL(/\/auth\/forgot-password/);
    await expect(page.getByRole('button', { name: /send|reset/i })).toBeVisible();
  });

  test('unauthenticated request to /dashboard is redirected to /auth/login', async ({ page }) => {
    /**
     * Verifies the proxy's catch-all protected-route gate. An anonymous
     * user must never see `/dashboard` — the proxy reads the access-token
     * cookie, finds it absent, and serves a 307/308 to `/auth/login` (the
     * `loginPath` configured in `apps/web/proxy.ts`).
     */
    await page.context().clearCookies();
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10_000 });
  });

  test('unauthenticated request to a role-gated route also redirects to /auth/login', async ({
    page,
  }) => {
    /**
     * Verifies that role-gated routes are reachable only when authenticated.
     * Pins the "more-specific pattern first" matching order in the proxy
     * (`/dashboard/team/:path*` is listed before the catch-all): a route
     * that fell through to the catch-all here would still redirect to
     * /auth/login on no auth, but the test name documents the more
     * specific behavior.
     */
    await page.context().clearCookies();
    await page.goto('/dashboard/team');
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10_000 });
  });

  test('a MEMBER navigating to /dashboard/team is redirected with ?error=forbidden', async ({
    page,
  }) => {
    /**
     * Verifies the proxy's role-denial branch — the heart of the per-route
     * RBAC gate. `/dashboard/team` is reserved for OWNER + ADMIN; a MEMBER
     * has a valid JWT but the role-denied path must redirect away.
     *
     * The proxy distinguishes "unauthenticated" from "authenticated but
     * wrong role": unauthenticated users go to `/auth/login` (handled by
     * the earlier test in this file), whereas role-denied users go back
     * to `/dashboard?error=forbidden` so the user lands on a page they
     * CAN see and the URL query carries the signal the dashboard can use
     * to surface a toast.
     */
    // Sign in as a tenant MEMBER first.
    await page.goto(`/auth/login?tenantId=${TENANT_ID}`);
    await page.getByLabel(/email/i).fill(MEMBER_EMAIL);
    await page.getByLabel(/password/i).fill(MEMBER_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('/dashboard', { timeout: 15_000 });

    // Sanity: a MEMBER must be allowed on `/dashboard` itself (the catch-all
    // protected route permits all four tenant roles). Pinning this also
    // distinguishes a "MEMBER login failed" outcome from a "team gate
    // working as intended" outcome.
    await expect(page).toHaveURL('/dashboard');

    // Now jump to the admin-only route. The proxy validates the role from
    // the JWT and redirects to `/dashboard?error=forbidden`. The forbidden
    // query is a stable contract the UI can read to surface the denial.
    await page.goto('/dashboard/team');
    await page.waitForURL(/\/dashboard\?error=forbidden/, { timeout: 10_000 });
  });
});
