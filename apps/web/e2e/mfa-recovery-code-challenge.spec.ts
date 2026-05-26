/**
 * @fileoverview E2E (FCM #33): MFA recovery-code path on the challenge UI.
 *
 * Exercises the failure-mode branch of the MFA flow — when a user has lost
 * their authenticator app and must fall back to one of the eight recovery
 * codes issued at enrollment. The spec covers:
 *
 *   1. Enrolling MFA inline (so the test is self-contained against the seed
 *      reset) and capturing every recovery code from the modal.
 *   2. Logging out and starting a fresh sign-in.
 *   3. Reaching the MFA challenge page after the password leg succeeds.
 *   4. Switching the challenge UI from the TOTP code input to the recovery
 *      code input via the "Use a recovery code" link.
 *   5. Submitting a real recovery code, landing on `/dashboard`, and
 *      confirming the API marked the code as consumed (the lib persists
 *      `mfaRecoveryCodes` minus the used hash).
 *
 * Uses `viewer.globex@example.com` so the spec does not conflict with the
 * other two MFA specs (`owner.acme` for mfa-enroll-and-login, `owner.globex`
 * for mfa-disable) nor with shared tenant users like `admin.acme` that
 * downstream specs (`notifications-isolation`, `tenant-switcher`) need at
 * `mfaEnabled: false`. Each Playwright invocation reseeds — at suite start
 * this user is reliably back to `mfaEnabled: false` / `mfaSecret: null` /
 * `mfaRecoveryCodes: []`.
 *
 * @layer test/e2e
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { authenticator } from 'otplib';

// Use `viewer.globex` — a seeded ACTIVE user no other live spec touches.
// The other MFA specs already claim `owner.acme` (mfa-enroll-and-login) and
// `owner.globex` (mfa-disable); using a third distinct user keeps the suite
// independent of run order and avoids leaving `mfaEnabled: true` on a user
// the rest of the suite tries to log into.
const MFA_EMAIL = process.env['E2E_MFA_RECOVERY_EMAIL'] ?? 'viewer.globex@example.com';
const MFA_PASSWORD = process.env['E2E_MFA_RECOVERY_PASSWORD'] ?? 'Passw0rd!Passw0rd';
const TENANT_ID = process.env['E2E_MFA_RECOVERY_TENANT'] ?? 'globex';

/** Mirrors `mfa-enroll-and-login.spec.ts` — keystroke-driven OTP fill. */
async function fillOtp(page: Page, code: string): Promise<void> {
  await page.locator('input[inputmode="numeric"]').first().click();
  await page.keyboard.type(code, { delay: 30 });
}

test.describe('MFA recovery code via challenge UI', () => {
  // Enroll + log out + log in + challenge ≈ two TOTP steps of waiting, plus
  // UI/network overhead. 120 s gives a comfortable margin without padding.
  test.setTimeout(120_000);

  test('signs in with a recovery code on the MFA challenge page', async ({ page }) => {
    /**
     * Full recovery-code flow (FCM #33, browser layer). Mirrors the lib's
     * recovery-code service test but at the UI surface — proves the
     * challenge page exposes the recovery-code branch and that the response
     * is processed by the same `mfaChallenge` client helper.
     */

    // ── 1. Sign in (no MFA yet). ───────────────────────────────────────────
    await page.goto(`/auth/login?tenantId=${TENANT_ID}`);
    await page.getByLabel(/email/i).fill(MFA_EMAIL);
    await page.getByLabel(/password/i).fill(MFA_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('/dashboard', { timeout: 15_000 });

    // ── 2. Enroll MFA from the security page. ──────────────────────────────
    await page.goto('/dashboard/security');
    await page
      .getByRole('button', { name: /set up authenticator|enable.*mfa|configure.*2fa/i })
      .click();

    const secretInput = page.getByTestId('mfa-secret');
    await expect(secretInput).toBeVisible({ timeout: 5_000 });
    const secret = await secretInput.inputValue();
    expect(secret.length).toBeGreaterThan(0);

    await fillOtp(page, authenticator.generate(secret));
    await page.getByRole('button', { name: /verify.*enable|confirm|enable/i }).click();

    // ── 3. Capture recovery codes from the post-enrollment modal. ──────────
    // The `RecoveryCodesModal` component renders each code inside a
    // `<span class="font-mono">` in a 2-column grid. We scope the locator
    // to the dialog so unrelated `font-mono` spans elsewhere on the page
    // (e.g. the header brand mark) do not pollute the list.
    await expect(page.getByText(/save your recovery codes/i)).toBeVisible({ timeout: 5_000 });
    const codeNodes = await page.getByRole('alertdialog').locator('span.font-mono').allInnerTexts();
    const recoveryCodes = codeNodes.map((t) => t.trim()).filter((t) => t.length > 0);
    // The lib issues 8 codes by default; assert ≥ 4 so the test is robust
    // to a consumer that lowered the count via `mfa.recoveryCodeCount`.
    expect(recoveryCodes.length).toBeGreaterThanOrEqual(4);
    const recoveryCode = recoveryCodes[0];
    expect(recoveryCode).toBeTruthy();

    // Dismiss the modal so navigation away is not blocked.
    await page.getByRole('button', { name: /saved my codes/i }).click();

    // ── 4. Sign out cleanly and start a fresh sign-in. ─────────────────────
    // Direct POST to /api/auth/logout invalidates the session so the next
    // login triggers a real MFA challenge (the proxy's
    // `publicRoutesRedirectIfAuthenticated` would otherwise bounce the
    // user back into the dashboard).
    await page.request.post('/api/auth/logout').catch(() => null);
    await page.context().clearCookies();
    await page.goto(`/auth/login?tenantId=${TENANT_ID}`);

    await page.getByLabel(/email/i).fill(MFA_EMAIL);
    await page.getByLabel(/password/i).fill(MFA_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    // ── 5. Reach the MFA challenge page. ───────────────────────────────────
    await page.waitForURL(/\/auth\/mfa-challenge/, { timeout: 10_000 });

    // ── 6. Switch to the recovery-code branch. ─────────────────────────────
    // The page renders the TOTP input by default; clicking the "Use a
    // recovery code" link toggles the input to a free-form text field that
    // accepts a recovery code instead. Pin the link text via a permissive
    // regex so a small copy edit ("Use recovery code instead") still works.
    await page
      .getByRole('button', { name: /use.*recovery code|recovery code instead/i })
      .or(page.getByRole('link', { name: /use.*recovery code|recovery code instead/i }))
      .click();

    // ── 7. Submit the captured recovery code. ──────────────────────────────
    // The recovery-code input is a single `<input>` accepting alpha-numeric
    // segments. Using a permissive label regex keeps the test resilient to
    // small copy edits.
    const recoveryInput = page.getByLabel(/recovery code/i);
    await expect(recoveryInput).toBeVisible({ timeout: 5_000 });
    await recoveryInput.fill(recoveryCode!);

    // Wait for the actual POST so we can assert it succeeded BEFORE checking
    // the UI — a stale page query would otherwise pass even on HTTP 4xx.
    const challengeResponse = page.waitForResponse(
      (r) => r.url().includes('/api/auth/mfa/challenge') && r.request().method() === 'POST',
      { timeout: 10_000 },
    );
    await page.getByRole('button', { name: /verify|submit|confirm/i }).click();
    const challengeResult = await challengeResponse;
    expect(challengeResult.status()).toBeLessThan(300);

    // ── 8. Should land on /dashboard after the challenge. ──────────────────
    await page.waitForURL('/dashboard', { timeout: 10_000 });

    // ── 9. Sanity check: /me confirms the dashboard token is for this user. ─
    const meResp = await page.request.get('/api/auth/me');
    expect(meResp.status()).toBe(200);
    const me = (await meResp.json()) as { email?: string; mfaEnabled?: boolean };
    expect(me.email).toBe(MFA_EMAIL);
    // MFA remains enabled — using a recovery code consumes one entry but
    // does NOT disable the feature. A regression that flipped `mfaEnabled`
    // to false on recovery-code use would fail this assertion.
    expect(me.mfaEnabled).toBe(true);

    // ── 10. Replay protection: the consumed code must NOT work again. ──────
    // The lib persists `mfaRecoveryCodes` minus the consumed hash. Drive
    // a second sign-in attempt and try the same code — expect a 4xx.
    await page.request.post('/api/auth/logout').catch(() => null);
    await page.context().clearCookies();
    await page.goto(`/auth/login?tenantId=${TENANT_ID}`);
    await page.getByLabel(/email/i).fill(MFA_EMAIL);
    await page.getByLabel(/password/i).fill(MFA_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/auth\/mfa-challenge/, { timeout: 10_000 });

    await page
      .getByRole('button', { name: /use.*recovery code|recovery code instead/i })
      .or(page.getByRole('link', { name: /use.*recovery code|recovery code instead/i }))
      .click();
    await page.getByLabel(/recovery code/i).fill(recoveryCode!);
    const replayResponse = page.waitForResponse(
      (r) => r.url().includes('/api/auth/mfa/challenge') && r.request().method() === 'POST',
      { timeout: 10_000 },
    );
    await page.getByRole('button', { name: /verify|submit|confirm/i }).click();
    const replayResult = await replayResponse;
    // The lib should reject the replay with 4xx (MFA_INVALID_CODE or similar).
    // We don't pin the exact code here — the goal is to prove the consumed
    // code does not reauthorize, regardless of the specific error envelope.
    expect(replayResult.status()).toBeGreaterThanOrEqual(400);
    expect(replayResult.status()).toBeLessThan(500);

    // The test ends with the user stuck on the MFA challenge page after a
    // rejected replay. That is acceptable: each Playwright test runs in
    // its own browser context, so leaving the page on `/auth/mfa-challenge`
    // does not leak state into the next spec. A "best-effort" cleanup that
    // tried to log back in was removed because it depended on the
    // recovery-code/authenticator-code toggle staying interactive after
    // a rejected POST, which is not a contract the page guarantees.
  });
});
