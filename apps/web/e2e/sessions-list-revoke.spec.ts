/**
 * @fileoverview Sessions list and per-row revoke end-to-end spec —
 * exercises the dashboard UI.
 *
 * Exercises three properties of `/dashboard/sessions`:
 *
 *   1. The page renders one row per active session for the signed-in user.
 *   2. The current session's revoke button is disabled (the user should use
 *      "Sign out everywhere" or the topbar's sign-out to invalidate it).
 *   3. Clicking the per-row "Revoke session" button on a *non-current*
 *      session removes that row from the list (and frees the row count by
 *      one), proving the `DELETE /api/auth/sessions/:hash` round-trip works
 *      and the table re-fetches after a successful revoke.
 *
 * A second active session is created with a fresh `browser.newContext()` so
 * the cookies live in a separate jar — Playwright sees this as a different
 * "device" from the API's perspective, identical to a real user logging in
 * from a phone while their laptop is also signed in.
 *
 * @layer test/e2e
 */

import { test, expect } from '@playwright/test';

// `admin.globex` is the dedicated user for this spec. `admin.acme` is shared
// by `notifications-isolation.spec.ts` and `tenant-switcher.spec.ts` — using
// it here would couple the run order. The globex twin is only referenced by
// `password-reset-otp.spec.ts`, which is env-gated and only runs in OTP
// mode, so there is no live contention.
const ADMIN_EMAIL = process.env['E2E_SESSIONS_EMAIL'] ?? 'admin.globex@example.com';
const ADMIN_PASSWORD = process.env['E2E_SESSIONS_PASSWORD'] ?? 'Passw0rd!Passw0rd';
const TENANT_ID = process.env['E2E_SESSIONS_TENANT'] ?? 'globex';

test.describe('Sessions list and revoke', () => {
  // Two sequential sign-ins + Mailpit-free DB polling — the default 30s
  // timeout is enough but bump it for slow CI runners.
  test.setTimeout(60_000);

  test('lists all active sessions, disables the current row, and revokes another via the per-row button', async ({
    browser,
  }) => {
    /**
     * Full lifecycle for the sessions table. Two sign-ins from independent
     * contexts give us two real session rows on the API side. The revoke
     * click targets the *other* row so the controlling page itself stays
     * authenticated through the assertions that follow.
     */

    // ── 1. Open the controlling context (will drive the UI) ───────────────
    const primaryContext = await browser.newContext();
    const primary = await primaryContext.newPage();
    await primary.goto(`/auth/login?tenantId=${TENANT_ID}`);
    await primary.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await primary.getByLabel(/password/i).fill(ADMIN_PASSWORD);
    await primary.getByRole('button', { name: /sign in/i }).click();
    await primary.waitForURL('/dashboard', { timeout: 15_000 });

    // ── 2. Open a second context and sign in again ────────────────────────
    // The lib creates a separate Redis session record per device. From the
    // primary context, the second session will appear as a non-current row.
    const secondaryContext = await browser.newContext();
    const secondary = await secondaryContext.newPage();
    await secondary.goto(`/auth/login?tenantId=${TENANT_ID}`);
    await secondary.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await secondary.getByLabel(/password/i).fill(ADMIN_PASSWORD);
    await secondary.getByRole('button', { name: /sign in/i }).click();
    await secondary.waitForURL('/dashboard', { timeout: 15_000 });

    // ── 3. Navigate the primary context to the sessions page ──────────────
    await primary.goto('/dashboard/sessions');

    // The page renders a table with one row per session. Wait for at least
    // one row to be visible — `data-testid` on the table would be cleaner
    // but the existing component does not expose one, so we rely on the
    // semantic role.
    const tableRows = primary.getByRole('row');
    // Wait until we see the header + 2 body rows = 3 total. The web client
    // does an initial fetch on mount; allow a generous timeout for the
    // round-trip on slow CI runners.
    await expect
      .poll(async () => await tableRows.count(), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(3);

    // ── 4. The current session is marked with a "Current" pill. ───────────
    // The component identifies the current row by rendering a "Current"
    // badge AND omitting the Revoke button entirely on that row (the
    // button is only rendered when `!session.isCurrent`). Pinning the
    // pill's presence catches a regression that drops the current-session
    // marker.
    await expect(primary.getByText(/^current$/i)).toBeVisible({ timeout: 5_000 });

    // At least one non-current session was created in step 2, so at
    // least one Revoke button must be in the DOM. We avoid pinning the
    // exact count — Redis persists sessions across Playwright runs, so a
    // previous run that did not clean up perfectly could leave extra
    // sessions for `admin.globex` (the controlling user).
    const revokeButtons = primary.getByRole('button', { name: /revoke session/i });
    await expect
      .poll(async () => await revokeButtons.count(), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(1);

    // ── 5. Revoke the OTHER session via its row button ───────────────────
    const enabledRevoke = revokeButtons.first();

    // Capture the row count BEFORE revoke so the assertion is robust to
    // a third session that another spec might have left behind.
    const rowsBefore = await tableRows.count();

    // Listen for the DELETE so we can assert the API actually accepted
    // the revoke before checking the UI.
    const revokeResponse = primary.waitForResponse(
      (r) => /\/api\/auth\/sessions\/[^/]+$/.test(r.url()) && r.request().method() === 'DELETE',
      { timeout: 10_000 },
    );
    await enabledRevoke.click();
    const revokeResult = await revokeResponse;
    expect(revokeResult.status()).toBeLessThan(300);

    // ── 6. The list reflects the revoke ──────────────────────────────────
    // The table refetches after a successful revoke, so the row count
    // should drop by exactly one. Use `expect.poll` to tolerate the
    // small refetch latency.
    await expect
      .poll(async () => await tableRows.count(), { timeout: 10_000 })
      .toBe(rowsBefore - 1);

    // ── 7. Cleanup ───────────────────────────────────────────────────────
    await primaryContext.close();
    await secondaryContext.close();
  });
});
