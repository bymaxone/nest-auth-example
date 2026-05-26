/**
 * @fileoverview E2E (FCM #1 + #5): registration form + email verification UI.
 *
 * Closes the two FCM rows that previously had only API-layer coverage
 * (`apps/api/test/register-and-verify.e2e-spec.ts`) and no Playwright spec.
 * Walks the full new-user onboarding journey:
 *
 *   1. Visit `/auth/register?tenantId=acme` with a synthetic email.
 *   2. Fill the form (email, name, password, tenant dropdown defaulting to acme).
 *   3. Submit — expect the "check your email" confirmation screen.
 *   4. Mailpit captures the verification OTP.
 *   5. Navigate to `/auth/verify-email?email=...&tenantId=...` and enter the OTP.
 *   6. Expect redirect to `/auth/login?verified=1` (or any /auth/login URL).
 *   7. Sign in with the new credentials and land on `/dashboard`.
 *
 * The synthetic email is randomized per run so the test never collides
 * with a seeded user or with a previous flaky run. The seeded users
 * cannot be reused for this spec because the seed marks them
 * `emailVerified: true` from the start — there would be nothing to verify.
 *
 * @layer test/e2e
 */

import { test, expect } from '@playwright/test';
import { waitForEmail, clearMailpit, extractOtp } from './fixtures/mailpit.js';

const TENANT_ID = process.env['E2E_TENANT_ID'] ?? 'acme';

test.describe('Register + verify email', () => {
  // Mailpit polling + 3 page navigations + 1 sign-in usually settle in
  // 10–15s; pad to 60s so a slow CI runner does not flake.
  test.setTimeout(60_000);

  test.beforeEach(async () => {
    /**
     * Mailpit retains messages across runs by default. Clearing at the
     * start guarantees `waitForEmail` returns *this* test's verification
     * OTP, not one left behind by an earlier spec.
     */
    await clearMailpit();
  });

  test('registers a fresh account, verifies the OTP, and signs in', async ({ page }) => {
    /**
     * Full onboarding flow at the browser layer (FCM #1 + #5). The
     * library returns 201 on register and stays silent on the verify
     * round-trip; this spec proves the UI surfaces both steps correctly
     * and that the verified flag actually persists (the sign-in at the
     * end would 401 otherwise — the example refuses to log a user in
     * with `emailVerified: false` and `emailVerification.required: true`).
     */

    // ── 1. Build a one-shot email + strong password. ───────────────────────
    // The synthetic local-part is unique per ms so the user is guaranteed
    // not to exist yet. Lowercased because the API normalizes emails on
    // both register and verify.
    const email = `e2e-register-${Date.now()}@example.test`;
    const password = `RegisterPass-${Date.now().toString()}!`;
    const name = 'E2E Register User';

    // ── 2. Visit the register page and submit the form. ────────────────────
    await page.goto(`/auth/register?tenantId=${TENANT_ID}`);

    // Wait for the form to mount — the inputs are async-loaded by RHF.
    await expect(page.getByLabel(/email/i)).toBeVisible();

    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/display name/i).fill(name);
    await page.getByLabel(/password/i).fill(password);

    // Tenant dropdown — defaults to acme (FCM #20 maps the seeded slugs).
    // The dropdown is a `<select>` of slug values (`acme`, `globex`); pick
    // the value directly so the test does not break if the visible label
    // is edited.
    const tenantSelect = page.getByLabel(/workspace/i);
    if (await tenantSelect.isVisible({ timeout: 500 }).catch(() => false)) {
      await tenantSelect.selectOption(TENANT_ID);
    }

    // Submit. The form posts to `/api/auth/register` and the page
    // transitions to a "Check your email" confirmation panel (it does not
    // redirect — the inner state flips on success).
    const registerResponse = page.waitForResponse(
      (r) => r.url().includes('/api/auth/register') && r.request().method() === 'POST',
      { timeout: 10_000 },
    );
    await page.getByRole('button', { name: /create account|register|sign up/i }).click();
    const registerResult = await registerResponse;
    expect(registerResult.status()).toBeLessThan(300);

    // ── 3. Confirmation screen renders. ────────────────────────────────────
    // The page swaps the form for a panel that includes the registered
    // email in the body. Pinning both the heading and the email occurrence
    // catches a regression that drops either half.
    await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(email)).toBeVisible();

    // ── 4. Pull the verification OTP from Mailpit. ─────────────────────────
    const html = await waitForEmail(email, 15_000);
    const otp = extractOtp(html);
    expect(otp).toMatch(/^\d{6}$/);

    // ── 5. Open the verify-email page and submit the OTP. ──────────────────
    // The library's email template links to this URL with the tenant's
    // CUID (not the slug) — the page sends the query value verbatim to
    // `POST /api/auth/verify-email`, and the API's `User.tenantId` FK
    // expects the real CUID. We resolve the slug here so the navigation
    // mirrors what a real user clicking the email link would see.
    const resolveResp = await page.request.get(
      `/api/tenants/resolve?slug=${encodeURIComponent(TENANT_ID)}`,
    );
    expect(resolveResp.status()).toBe(200);
    const { id: tenantCuid } = (await resolveResp.json()) as { id: string };
    await page.goto(
      `/auth/verify-email?email=${encodeURIComponent(email)}&tenantId=${encodeURIComponent(tenantCuid)}`,
    );

    // OtpInput is keyboard-driven — the same pattern used by the MFA specs.
    await page.locator('input[inputmode="numeric"]').first().click();
    await page.keyboard.type(otp, { delay: 30 });

    // Submit. Capture the verify-email POST so the assertion pins the
    // server-side 2xx before checking the UI redirect.
    const verifyResponse = page.waitForResponse(
      (r) => r.url().includes('/api/auth/verify-email') && r.request().method() === 'POST',
      { timeout: 10_000 },
    );
    await page.getByRole('button', { name: /verify email|verify|submit/i }).click();
    const verifyResult = await verifyResponse;
    expect(verifyResult.status()).toBeLessThan(300);

    // ── 6. Land on the post-verify destination. ───────────────────────────
    // The lib's register endpoint issues access + refresh cookies even
    // when `emailVerification.required: true` (the JWT carries
    // `emailVerified: false` until the user verifies). After the
    // verify-email round-trip completes, the page can either redirect to
    // `/auth/login?verified=1` (when the user is not authenticated) OR
    // navigate straight to `/dashboard` (when the user was registered
    // with cookies and is now fully verified). Accept either outcome —
    // the goal is to confirm the verification persisted, not pin the
    // exact navigation target.
    await page.waitForURL(/\/auth\/login|\/dashboard/, { timeout: 10_000 });

    // ── 7. Ensure we end up on /dashboard authenticated. ──────────────────
    // If the page bounced to /auth/login, complete the sign-in to prove
    // the new password is accepted. If we are already on /dashboard, this
    // branch is a no-op.
    if (page.url().includes('/auth/login')) {
      await page.getByLabel(/email/i).fill(email);
      await page.getByLabel(/password/i).fill(password);
      await page.getByRole('button', { name: /sign in/i }).click();
      await page.waitForURL('/dashboard', { timeout: 15_000 });
    }

    // ── 8. Sanity: /me confirms the user is verified. ─────────────────────
    const meResp = await page.request.get('/api/auth/me');
    expect(meResp.status()).toBe(200);
    const me = (await meResp.json()) as { email?: string; emailVerified?: boolean };
    expect(me.email).toBe(email);
    expect(me.emailVerified).toBe(true);
  });
});
