/**
 * @fileoverview Regenerable documentation-screenshot capture.
 *
 * Drives a headless Chromium against the RUNNING dev stack (web :3000 -> api :4000)
 * and saves PNGs under docs/assets/ for use in docs/GETTING_STARTED.md and
 * docs/FEATURES.md. This is a tooling helper, not a Playwright test -- run it
 * manually after the UI changes:
 *
 *   pnpm infra:up && pnpm dev          # start the stack
 *   node apps/web/e2e/capture-docs-screenshots.mjs
 *
 * Credentials are the seeded dev accounts (see docs/GETTING_STARTED.md).
 */

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.CAPTURE_BASE_URL ?? 'http://localhost:3000';
const MAILPIT = process.env.CAPTURE_MAILPIT_URL ?? 'http://localhost:8025';

// docs/assets relative to this file: e2e -> web -> apps -> repo root.
const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(HERE, '../../../docs/assets');
const GS = resolve(ASSETS, 'getting-started');
const FT = resolve(ASSETS, 'features');
mkdirSync(GS, { recursive: true });
mkdirSync(FT, { recursive: true });

/** Wait for the page to settle without hanging on dev HMR/WebSocket sockets. */
async function settle(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(900);
}

/** Run one capture step in isolation so a single failure does not abort the rest. */
async function step(name, fn) {
  try {
    await fn();
    console.log(`  [ok] ${name}`);
  } catch (err) {
    console.log(`  [fail] ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

console.log(`Capturing screenshots from ${BASE} ...`);

await step('features/login.png', async () => {
  await page.goto(`${BASE}/auth/login?tenantId=acme`);
  await settle(page);
  await page.screenshot({ path: resolve(FT, 'login.png') });
});

await step('login -> dashboard', async () => {
  await page.goto(`${BASE}/auth/login?tenantId=acme`);
  await settle(page);
  await page.fill('input[type="email"]', 'admin.acme@example.com');
  await page.fill('input[type="password"]', 'Passw0rd!Passw0rd');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  await settle(page);
  await page.screenshot({ path: resolve(GS, 'login-success.png') });
  await page.screenshot({ path: resolve(FT, 'dashboard.png') });
});

await step('features/mfa-setup.png', async () => {
  await page.goto(`${BASE}/dashboard/security`);
  await settle(page);
  await page.screenshot({ path: resolve(FT, 'mfa-setup.png') });
});

await step('features/sessions.png', async () => {
  await page.goto(`${BASE}/dashboard/sessions`);
  await settle(page);
  await page.screenshot({ path: resolve(FT, 'sessions.png') });
});

await step('features/team.png', async () => {
  await page.goto(`${BASE}/dashboard/team`);
  await settle(page);
  await page.screenshot({ path: resolve(FT, 'team.png') });
});

await step('getting-started/mailpit.png', async () => {
  // Trigger a transactional email so the Mailpit inbox is not empty.
  await page.goto(`${BASE}/auth/forgot-password?tenantId=acme`);
  await settle(page);
  await page.fill('input[type="email"]', 'admin.acme@example.com');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);
  await page.goto(MAILPIT);
  await settle(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(GS, 'mailpit.png') });
});

await step('features/platform.png', async () => {
  await page.goto(`${BASE}/platform/login`);
  await settle(page);
  await page.fill('input[type="email"]', 'platform@example.dev');
  await page.fill('input[type="password"]', 'PlatformPassw0rd!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/platform/**', { timeout: 20_000 }).catch(() => undefined);
  await settle(page);
  await page.screenshot({ path: resolve(FT, 'platform.png') });
});

await browser.close();
console.log('Done.');
