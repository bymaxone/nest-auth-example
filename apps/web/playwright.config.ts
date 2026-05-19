/**
 * @fileoverview Playwright configuration for the Next.js web application.
 *
 * `webServer` starts the Next.js webpack dev server automatically before any
 * test file runs and tears it down after the suite. The API and infrastructure
 * (PostgreSQL, Redis, Mailpit) must already be running — see
 * docs/DEVELOPMENT_PLAN.md Appendix A for the startup sequence:
 *
 *   pnpm infra:up
 *   pnpm --filter @nest-auth-example/api dev
 *   pnpm --filter @nest-auth-example/web test:e2e   ← starts web + runs tests
 *
 * AUTH_JWT_SECRET_FOR_PROXY is read from apps/api/.env at config-load time so
 * it always matches the API's JWT_SECRET without duplication.
 *
 * @layer test/e2e
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Reads a single KEY=value pair from an .env file. Returns undefined if the
 * file or key does not exist. Intentionally minimal — no full dotenv parsing.
 */
function readEnvKey(filePath: string, key: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return match?.[1]?.trim();
}

/** JWT_SECRET from the running API — must match AUTH_JWT_SECRET_FOR_PROXY. */
const apiJwtSecret = readEnvKey(path.join(__dirname, '../api/.env'), 'JWT_SECRET');

/**
 * Playwright configuration — targets the Next.js dev server managed by webServer.
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

  /**
   * Starts the Next.js webpack dev server before any test file runs.
   *
   * `reuseExistingServer: true` lets developers pre-start the server manually
   * for faster iteration — Playwright will connect to it instead of spawning a
   * new one. Set to `false` on CI to guarantee a clean server process.
   */
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    env: {
      // Required by lib/env.ts — schema validation rejects startup without these.
      INTERNAL_API_URL: process.env['INTERNAL_API_URL'] ?? 'http://localhost:4000',
      // Read from apps/api/.env so this always matches the running API without
      // duplicating the secret. Falls back to the env var if the file is absent
      // (e.g. CI, where secrets are injected via env).
      AUTH_JWT_SECRET_FOR_PROXY: process.env['AUTH_JWT_SECRET_FOR_PROXY'] ?? apiJwtSecret ?? '',
      NEXT_PUBLIC_API_URL: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000/api',
      NEXT_PUBLIC_WS_URL: process.env['NEXT_PUBLIC_WS_URL'] ?? 'ws://localhost:3000',
      NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED: process.env['NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED'] ?? 'false',
    },
  },
});
