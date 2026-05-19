/**
 * @fileoverview Authenticated page fixture for Playwright e2e tests.
 *
 * Provides a reusable `authenticatedPage` fixture that logs in once per
 * role and persists session storage so subsequent tests skip the login form.
 * Storage state is saved to `.auth/<role>.json`.
 *
 * Usage:
 * ```typescript
 * import { test } from './fixtures/auth.js';
 *
 * test('dashboard is visible', async ({ authenticatedPage: page }) => {
 *   await expect(page).toHaveURL('/dashboard');
 * });
 * ```
 *
 * @layer test/e2e/fixtures
 * @see docs/DEVELOPMENT_PLAN.md §Phase 17 P17-10
 */

import path from 'node:path';
import fs from 'node:fs';
import { test as base, type Page, type BrowserContext } from '@playwright/test';

/** Known roles for typed storage paths. */
export type AuthRole = 'member' | 'admin' | 'platform-admin';

/** Credentials used to authenticate per role. */
const CREDENTIALS: Record<AuthRole, { email: string; password: string; tenantId?: string }> = {
  member: {
    email: process.env['E2E_MEMBER_EMAIL'] ?? 'member@example.dev',
    password: process.env['E2E_MEMBER_PASSWORD'] ?? 'MemberPassw0rd!',
    tenantId: process.env['E2E_TENANT_ID'] ?? 'acme',
  },
  admin: {
    email: process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.dev',
    password: process.env['E2E_ADMIN_PASSWORD'] ?? 'AdminPassw0rd!',
    tenantId: process.env['E2E_TENANT_ID'] ?? 'acme',
  },
  'platform-admin': {
    email: process.env['E2E_PLATFORM_EMAIL'] ?? 'platform@example.dev',
    password: process.env['E2E_PLATFORM_PASSWORD'] ?? 'PlatformPassw0rd!',
  },
};

/** Directory for persisted auth storage state files. */
const AUTH_DIR = path.join(process.cwd(), '.auth');

/**
 * Returns the storage-state path for a given role.
 *
 * @param role - The role whose storage state path to return.
 */
export function storageStatePath(role: AuthRole): string {
  return path.join(AUTH_DIR, `${role}.json`);
}

/**
 * Logs in via the browser and saves session storage state to disk.
 *
 * @param page - Playwright page to drive.
 * @param context - Browser context whose storage state to save.
 * @param role - The role to authenticate as.
 */
async function loginAndSave(page: Page, context: BrowserContext, role: AuthRole): Promise<void> {
  const creds = CREDENTIALS[role];
  const loginPath = role === 'platform-admin' ? '/platform/login' : '/auth/login';
  const dashboardPath = role === 'platform-admin' ? '/platform/tenants' : '/dashboard';

  // Include tenantId in URL so the login page can resolve slug → CUID and
  // set the tenant_id cookie before calling the API (tenantIdResolver reads
  // only from the X-Tenant-Id header, which tenantAwareFetch injects from that cookie).
  const tenantQuery = creds.tenantId ? `?tenantId=${creds.tenantId}` : '';
  await page.goto(`${loginPath}${tenantQuery}`);

  await page.getByLabel(/email/i).fill(creds.email);
  await page.getByLabel(/password/i).fill(creds.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(dashboardPath, { timeout: 15_000 });

  // Persist storage state so future tests reuse it.
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await context.storageState({ path: storageStatePath(role) });
}

type AuthFixtures = {
  /** Page pre-authenticated as a tenant member. */
  memberPage: Page;
  /** Page pre-authenticated as a tenant admin. */
  adminPage: Page;
  /** Page pre-authenticated as a platform administrator. */
  platformAdminPage: Page;
};

/**
 * Extended Playwright `test` with pre-authenticated page fixtures.
 *
 * Import this `test` in place of `@playwright/test`'s `test` in specs that
 * need an authenticated user without repeating the login flow.
 */
export const test = base.extend<AuthFixtures>({
  memberPage: async ({ page, context }, use) => {
    const statePath = storageStatePath('member');
    if (!fs.existsSync(statePath)) {
      await loginAndSave(page, context, 'member');
    } else {
      await context.addCookies(
        (
          JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
            cookies: Parameters<BrowserContext['addCookies']>[0];
          }
        ).cookies,
      );
    }
    await use(page);
  },

  adminPage: async ({ page, context }, use) => {
    const statePath = storageStatePath('admin');
    if (!fs.existsSync(statePath)) {
      await loginAndSave(page, context, 'admin');
    } else {
      await context.addCookies(
        (
          JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
            cookies: Parameters<BrowserContext['addCookies']>[0];
          }
        ).cookies,
      );
    }
    await use(page);
  },

  platformAdminPage: async ({ page, context }, use) => {
    const statePath = storageStatePath('platform-admin');
    if (!fs.existsSync(statePath)) {
      await loginAndSave(page, context, 'platform-admin');
    } else {
      await context.addCookies(
        (
          JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
            cookies: Parameters<BrowserContext['addCookies']>[0];
          }
        ).cookies,
      );
    }
    await use(page);
  },
});

export { expect } from '@playwright/test';
