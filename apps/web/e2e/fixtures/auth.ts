/**
 * @fileoverview Authenticated page fixtures for Playwright e2e tests.
 *
 * Signs each persona in **once per run** and replays the resulting session into
 * every later test that asks for it. This is not only a speed optimisation: the
 * API rate-limits `POST /auth/login` to 5 requests per minute per IP, and every
 * request in this suite originates from the same address, so a suite that logs
 * in per test spends the whole tier and starts collecting HTTP 429s.
 *
 * Two different session mechanisms are in play, and both have to be carried:
 *
 * - **Tenant sessions are cookie-based** (`access_token`, `refresh_token`,
 *   `tenant_id`, `has_session`), which `context.storageState()` captures.
 * - **Platform-admin sessions live entirely in `sessionStorage`**
 *   (`platform_access_token`, `platform_refresh_token`, `platform_admin`) and
 *   set no cookie at all. Playwright's `storageState()` persists cookies and
 *   `localStorage` only, so a platform session has to be snapshotted by hand
 *   and re-seeded through an init script that runs before page scripts.
 *
 * Storage lands in `.auth/<role>.json` (cookies) and `.auth/<role>.session.json`
 * (sessionStorage).
 *
 * Usage:
 * ```typescript
 * import { test, expect } from './fixtures/auth.js';
 *
 * test('dashboard is visible', async ({ memberPage: page }) => {
 *   await page.goto('/dashboard');
 * });
 * ```
 *
 * A spec whose subject **is** the login or token-rotation flow must keep
 * signing in itself — replaying a shared session would either bypass the code
 * under test or reuse an already-rotated refresh token.
 *
 * @layer test/e2e/fixtures
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
 * Returns the cookie storage-state path for a given role.
 *
 * @param role - The role whose storage state path to return.
 */
export function storageStatePath(role: AuthRole): string {
  return path.join(AUTH_DIR, `${role}.json`);
}

/**
 * Returns the `sessionStorage` snapshot path for a given role.
 *
 * @param role - The role whose session snapshot path to return.
 */
function sessionStatePath(role: AuthRole): string {
  return path.join(AUTH_DIR, `${role}.session.json`);
}

/** Shape of the cookie half of a persisted session. */
interface PersistedCookies {
  cookies: Parameters<BrowserContext['addCookies']>[0];
}

/**
 * Logs in through the UI and persists both halves of the resulting session.
 *
 * @param page - Playwright page to drive.
 * @param context - Browser context whose session to capture.
 * @param role - The role to authenticate as.
 */
async function loginAndSave(page: Page, context: BrowserContext, role: AuthRole): Promise<void> {
  const creds = CREDENTIALS[role];
  const loginPath = role === 'platform-admin' ? '/platform/login' : '/auth/login';
  const landingPath = role === 'platform-admin' ? '/platform/tenants' : '/dashboard';

  // Include tenantId in URL so the login page can resolve slug → CUID and
  // set the tenant_id cookie before calling the API (tenantIdResolver reads
  // only from the X-Tenant-Id header, which tenantAwareFetch injects from that cookie).
  const tenantQuery = creds.tenantId ? `?tenantId=${creds.tenantId}` : '';
  await page.goto(`${loginPath}${tenantQuery}`);

  await page.getByLabel(/email/i).fill(creds.email);
  await page.getByLabel(/password/i).fill(creds.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(landingPath, { timeout: 15_000 });

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await context.storageState({ path: storageStatePath(role) });

  // Captured separately because `storageState()` covers cookies and
  // localStorage but never sessionStorage, which is the only place a
  // platform-admin session exists.
  const sessionEntries = await page.evaluate(() => JSON.stringify(window.sessionStorage));
  fs.writeFileSync(sessionStatePath(role), sessionEntries, 'utf8');
}

/**
 * Replays a previously captured session into a fresh browser context.
 *
 * @param context - The context to seed.
 * @param role - The role whose stored session to replay.
 */
async function restoreSession(context: BrowserContext, role: AuthRole): Promise<void> {
  const cookieFile = fs.readFileSync(storageStatePath(role), 'utf8');
  const { cookies } = JSON.parse(cookieFile) as PersistedCookies;
  if (cookies.length > 0) {
    await context.addCookies(cookies);
  }

  const sessionFile = sessionStatePath(role);
  if (!fs.existsSync(sessionFile)) return;

  // An init script rather than a plain `evaluate`: sessionStorage has to be
  // populated before the app's own scripts read it on first paint, and it must
  // be re-applied on every navigation within the context.
  const snapshot = fs.readFileSync(sessionFile, 'utf8');
  await context.addInitScript((serialized: string) => {
    const entries = JSON.parse(serialized) as Record<string, string>;
    for (const [key, value] of Object.entries(entries)) {
      window.sessionStorage.setItem(key, value);
    }
  }, snapshot);
}

/**
 * Returns a page authenticated as `role`, signing in only on the first call.
 *
 * @param page - The test's page.
 * @param context - The test's browser context.
 * @param role - The persona to authenticate as.
 */
async function authenticate(page: Page, context: BrowserContext, role: AuthRole): Promise<Page> {
  if (fs.existsSync(storageStatePath(role))) {
    await restoreSession(context, role);
  } else {
    await loginAndSave(page, context, role);
  }
  return page;
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
    await use(await authenticate(page, context, 'member'));
  },

  adminPage: async ({ page, context }, use) => {
    await use(await authenticate(page, context, 'admin'));
  },

  platformAdminPage: async ({ page, context }, use) => {
    await use(await authenticate(page, context, 'platform-admin'));
  },
});

export { expect } from '@playwright/test';
