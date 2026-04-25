/**
 * @fileoverview Playwright configuration for the Next.js web application.
 *
 * Runs E2E specs in the `e2e/` directory against the local dev server.
 * The API and infrastructure (PostgreSQL, Redis) must be running before
 * executing these tests — see GETTING_STARTED.md for the startup sequence.
 *
 * @layer test/e2e
 */

import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration — targets the local Next.js dev server.
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',

  /** Run all tests in each file sequentially to avoid race conditions on shared DB state. */
  fullyParallel: false,

  /** Fail the build on CI if a test.only() was accidentally left in. */
  forbidOnly: !!process.env['CI'],

  retries: process.env['CI'] ? 2 : 0,

  workers: 1,

  reporter: process.env['CI'] ? 'github' : 'list',

  use: {
    baseURL: process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
