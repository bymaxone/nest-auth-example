/**
 * @fileoverview Playwright globalSetup — runs once before the e2e suite.
 *
 * Ensures the dev-tier Postgres (the one Playwright's webServer hits via the
 * Next proxy → Nest API → Prisma) has the latest migrations applied and the
 * seed credentials inserted. The seed is idempotent (upsert by unique key)
 * and re-hashes `passwordHash` so existing rows always converge to the
 * canonical scrypt format the lib's `PasswordService.compare` expects.
 *
 * Triggered automatically by `playwright.config.ts → globalSetup`. Developers
 * never need to remember to run `pnpm prisma:migrate:deploy` / `prisma:seed`
 * before `pnpm test:e2e`.
 *
 * Pre-requisite: `pnpm infra:up` must have started the dev Postgres on :5432.
 * The `--wait` flag on `infra:up` guarantees the healthcheck has passed before
 * this script runs.
 *
 * @layer test/e2e
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(__dirname, '../../api');

/** Dev Postgres URL — same one the running Nest API uses (apps/api/.env). */
const DATABASE_URL =
  process.env['DATABASE_URL'] ??
  'postgresql://postgres:postgres@localhost:5432/example_app?schema=public';

/**
 * Idempotent: applies pending migrations, then runs the seed (upsert-based).
 * Inherits stdio so failures surface in the Playwright output stream.
 */
export default function globalSetup(): void {
  const env = { ...process.env, DATABASE_URL };
  const opts = { stdio: 'inherit' as const, cwd: apiDir, env };

  execSync('pnpm exec prisma migrate deploy', opts);
  execSync('pnpm exec tsx prisma/seed.ts', opts);
}
