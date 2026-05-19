/**
 * @fileoverview E2E: Admin sends invitation → invitee accepts via email link.
 *
 * Uses two browser contexts: the admin context sends the invite; an
 * anonymous context (simulating the invitee) opens the Mailpit-captured
 * link and completes registration.
 *
 * @layer test/e2e
 * @see docs/DEVELOPMENT_PLAN.md §Phase 17 P17-10
 */

import { test, expect } from '@playwright/test';
import { waitForEmail, clearMailpit, extractInviteToken } from './fixtures/mailpit.js';

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.dev';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'] ?? 'AdminPassw0rd!';
const TENANT_ID = process.env['E2E_TENANT_ID'] ?? 'acme';

test.describe('Invitation flow', () => {
  test.beforeEach(async () => {
    await clearMailpit();
  });

  test('admin sends invite → invitee receives email → accepts and can log in', async ({
    page,
    browser,
  }) => {
    /**
     * Full invitation flow (FCM #21).
     * Admin context sends the invite; a new browser context simulates the
     * invitee opening the invite link from their email client.
     */
    // 1. Log in as admin.
    await page.goto(`/auth/login?tenantId=${TENANT_ID}`);
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('/dashboard', { timeout: 15_000 });

    // 2. Navigate to the invitations page. The InviteForm is mounted inline
    //    (no modal/open-button), so we fill the email field directly. The
    //    Team page (/dashboard/team) is a read-only members list and has no
    //    invite affordance.
    await page.goto('/dashboard/invitations');
    const inviteeEmail = `invitee-${Date.now().toString()}@example.test`;
    await page.getByLabel(/email/i).fill(inviteeEmail);
    // Select a role if a role selector is visible.
    const roleSelect = page.getByRole('combobox', { name: /role/i });
    if (await roleSelect.isVisible({ timeout: 500 }).catch(() => false)) {
      await roleSelect.selectOption('MEMBER');
    }
    // Surface real API failures (validation, 4xx) at the click site instead of
    // letting them masquerade as the downstream "no email arrived" timeout.
    // 204 No Content is the documented success status — read .text() only on
    // failure (204 responses have no body and triggering .text() on them raises
    // "No data found for resource with given identifier" from Chrome DevTools).
    const inviteResponsePromise = page.waitForResponse(
      (r) => r.url().includes('/api/auth/invitations') && r.request().method() === 'POST',
      { timeout: 10_000 },
    );
    await page.getByRole('button', { name: /send invite/i }).click();
    const inviteResponse = await inviteResponsePromise;
    const status = inviteResponse.status();
    if (status >= 300) {
      throw new Error(
        `POST /api/auth/invitations failed: ${status} ${await inviteResponse.text()}`,
      );
    }

    // 3. Wait for the invitation email in Mailpit.
    const html = await waitForEmail(inviteeEmail, 10_000);
    const token = extractInviteToken(html);
    expect(token.length).toBeGreaterThan(0);

    // 4. Open the accept link in a fresh (unauthenticated) browser context.
    const inviteeContext = await browser.newContext();
    const inviteePage = await inviteeContext.newPage();
    await inviteePage.goto(`/auth/accept-invitation?token=${token}`);

    // 5. Fill in the invitation acceptance form.
    await inviteePage.getByLabel(/name/i).fill('Invited User');
    await inviteePage.getByLabel(/^password/i).fill('InvitePassw0rd!');
    const confirmField = inviteePage.getByLabel(/confirm|repeat/i);
    if (await confirmField.isVisible({ timeout: 500 }).catch(() => false)) {
      await confirmField.fill('InvitePassw0rd!');
    }
    await inviteePage.getByRole('button', { name: /accept|join|create/i }).click();

    // 6. Expect redirect to login or dashboard.
    await expect(
      inviteePage
        .waitForURL('/auth/login', { timeout: 10_000 })
        .catch(() => inviteePage.waitForURL('/dashboard', { timeout: 10_000 })),
    ).resolves.not.toThrow();

    await inviteeContext.close();
  });
});
