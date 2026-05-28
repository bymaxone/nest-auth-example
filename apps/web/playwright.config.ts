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
 * True when Playwright is invoked inside GitHub Actions (or any CI environment
 * where `CI=true`).  Used to switch between development servers (fast feedback
 * locally) and pre-built production servers (reproducible, fast-start in CI).
 */
const isCI = !!process.env['CI'];

/**
 * Playwright configuration — targets the Next.js dev server managed by webServer.
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',

  /**
   * Runs once before the suite — applies migrations and seeds the dev DB so
   * the 11 specs that authenticate with seeded credentials (admin.acme,
   * platform@example.dev, etc.) work whether the DB is empty (CI / fresh
   * `infra:nuke`) or already populated (incremental dev runs).
   *
   * Idempotent — safe to re-run on every invocation; cost ~1s when up-to-date.
   */
  globalSetup: './e2e/global-setup.ts',

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
   * Starts both the Nest API (:4000) and the Next.js server (:3000) before
   * any test file runs.  Both are required: Playwright drives the web UI, and
   * the web proxies every `/api/*` call to the Nest API.
   *
   * Two modes:
   *  - **Local dev** (`CI` unset): dev servers with hot-reload, pre-start
   *    allowed via `reuseExistingServer: true` for faster iteration.
   *  - **CI** (`CI=true`): pre-built production servers.  `next dev` and
   *    `nest start --watch` take 5-10 min to compile on CI runners; production
   *    servers start in seconds from the pre-built `dist/` and `.next/` artefacts
   *    produced by the build steps that precede this Playwright job.
   */
  webServer: [
    {
      // CI: node dist/main.js (pre-built by the CI build step, starts instantly).
      // Local: nest start --watch (dev server with TypeScript compilation + watch).
      command: isCI
        ? 'node ../../apps/api/dist/main.js'
        : 'pnpm --filter @nest-auth-example/api dev',
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: !isCI,
      // Production server starts in <10s; dev server needs up to 2 min.
      timeout: isCI ? 30_000 : 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        // Boot the API with OAuth ENABLED using format-valid placeholder
        // credentials. The OAUTH_GOOGLE_* trio is sufficient for the lib's
        // OAuth controller to mount and for the initiate endpoint to redirect
        // to `accounts.google.com` — which is all the click-through Playwright
        // spec asserts. Completing the OAuth handshake would talk to real
        // Google with these IDs, so the spec stops at the redirect and never
        // follows it. The format must match what Google emits (anything
        // ending in `.apps.googleusercontent.com`) because the lib templates
        // the value directly into the authorization URL.
        OAUTH_GOOGLE_CLIENT_ID:
          process.env['OAUTH_GOOGLE_CLIENT_ID'] ??
          'playwright-test-client.apps.googleusercontent.com',
        OAUTH_GOOGLE_CLIENT_SECRET:
          process.env['OAUTH_GOOGLE_CLIENT_SECRET'] ?? 'playwright-test-client-secret',
        OAUTH_GOOGLE_CALLBACK_URL:
          process.env['OAUTH_GOOGLE_CALLBACK_URL'] ??
          'http://localhost:4000/api/auth/oauth/google/callback',
      },
    },
    {
      // CI: next start (serves pre-built .next/, starts in ~2s).
      // Local: next dev (hot-reload, starts webpack compilation).
      command: isCI ? 'pnpm start' : 'pnpm dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !isCI,
      timeout: isCI ? 30_000 : 120_000,
      env: {
        // Required by lib/env.ts — schema validation rejects startup without these.
        INTERNAL_API_URL: process.env['INTERNAL_API_URL'] ?? 'http://localhost:4000',
        // Read from apps/api/.env so this always matches the running API without
        // duplicating the secret. Falls back to the env var if the file is absent
        // (e.g. CI, where secrets are injected via env).
        AUTH_JWT_SECRET_FOR_PROXY: process.env['AUTH_JWT_SECRET_FOR_PROXY'] ?? apiJwtSecret ?? '',
        NEXT_PUBLIC_API_URL: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000/api',
        NEXT_PUBLIC_WS_URL: process.env['NEXT_PUBLIC_WS_URL'] ?? 'ws://localhost:3000',
        // OAuth button visible in the UI for the click-through spec — the API
        // is configured above with matching placeholder credentials.
        NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED: process.env['NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED'] ?? 'true',
      },
    },
  ],
});
