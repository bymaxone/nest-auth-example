/**
 * @fileoverview Unit tests for the `env` module.
 *
 * Verifies that the `env` object is a frozen record with the expected keys when
 * all required environment variables are present. The env module is imported
 * dynamically after the fake process.env values have been injected so the
 * Zod schema validation runs against controlled test data.
 *
 * @module lib/env.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/** Original env snapshot — restored after all tests. */
const originalEnv = { ...process.env };

beforeAll(() => {
  // Inject all required env vars so the module loads without throwing.
  process.env['INTERNAL_API_URL'] = 'http://localhost:3001';
  process.env['AUTH_JWT_SECRET_FOR_PROXY'] = 'a-very-long-secret-of-at-least-32-chars!!';
  process.env['NEXT_PUBLIC_API_URL'] = 'http://localhost:3000/api';
  process.env['NEXT_PUBLIC_WS_URL'] = 'ws://localhost:3000';
  process.env['NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED'] = 'false';
});

afterAll(() => {
  // Restore process.env.
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  vi.resetModules();
});

describe('env', () => {
  it('exports a frozen object with all required keys', async () => {
    /*
     * Scenario: when all required environment variables are present the env
     * module must export a frozen object with the correct typed values.
     * Protects: Zod schema validates and Object.freeze is called on result.
     */
    // Import dynamically so the beforeAll env injection takes effect first.
    const { env } = await import('./env.js');

    expect(Object.isFrozen(env)).toBe(true);
    expect(env.INTERNAL_API_URL).toBe('http://localhost:3001');
    expect(env.AUTH_JWT_SECRET_FOR_PROXY).toBe('a-very-long-secret-of-at-least-32-chars!!');
    expect(env.NEXT_PUBLIC_API_URL).toBe('http://localhost:3000/api');
    expect(env.NEXT_PUBLIC_WS_URL).toBe('ws://localhost:3000');
    expect(env.NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED).toBe(false);
  });

  it('transforms NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED="true" to boolean true', async () => {
    /*
     * Scenario: the Zod schema must transform the string "true" to the boolean
     * true so callers can use it as a feature flag.
     * Protects: .transform(v => v === "true") applied to the OAUTH flag.
     */
    // Reset modules so a fresh module load occurs with the updated env.
    vi.resetModules();
    process.env['NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED'] = 'true';

    const { env } = await import('./env.js');

    expect(env.NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED).toBe(true);

    // Reset back for any subsequent tests.
    vi.resetModules();
    process.env['NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED'] = 'false';
  });

  it('throws with a descriptive error message when required env vars are missing', async () => {
    /*
     * Scenario: when a required variable is absent (e.g. INTERNAL_API_URL)
     * the module must throw with "Invalid web env:" and the variable path.
     * Protects: lines 72-76 — the error-throw branch when safeParse fails.
     */
    vi.resetModules();
    const savedUrl = process.env['INTERNAL_API_URL'];
    const savedSecret = process.env['AUTH_JWT_SECRET_FOR_PROXY'];
    delete process.env['INTERNAL_API_URL'];
    delete process.env['AUTH_JWT_SECRET_FOR_PROXY'];

    await expect(import('./env.js')).rejects.toThrow('Invalid web env:');

    // Restore.
    if (savedUrl !== undefined) process.env['INTERNAL_API_URL'] = savedUrl;
    if (savedSecret !== undefined) process.env['AUTH_JWT_SECRET_FOR_PROXY'] = savedSecret;
    vi.resetModules();
  });

  it('lists every missing variable by name and indents each one with the bullet prefix', async () => {
    /*
     * Scenario: operators staring at a `pnpm dev` crash need to see which
     * env vars failed validation so they can fix the `.env` file in one
     * pass. The error message must enumerate every missing variable on its
     * own line, prefixed with the bullet glyph, and use a dot as the path
     * separator for any nested Zod issue. Pins the multi-line render of
     * the validation issues — defending against a regression that drops
     * either the bullet glyph or the path-segment join character.
     */
    vi.resetModules();
    const savedUrl = process.env['INTERNAL_API_URL'];
    const savedSecret = process.env['AUTH_JWT_SECRET_FOR_PROXY'];
    delete process.env['INTERNAL_API_URL'];
    delete process.env['AUTH_JWT_SECRET_FOR_PROXY'];

    let captured: unknown;
    try {
      await import('./env.js');
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(Error);
    const message = (captured as Error).message;
    // Header line is the verbatim documented prefix.
    expect(message.startsWith('Invalid web env:\n')).toBe(true);
    // Every missing variable surfaces as its own bulleted line — both names
    // pinned to lock the per-issue mapper.
    expect(message).toMatch(/^ {2}• INTERNAL_API_URL: /m);
    expect(message).toMatch(/^ {2}• AUTH_JWT_SECRET_FOR_PROXY: /m);
    // Issues are joined with newlines, not concatenated together.
    const bulletLines = message.split('\n').filter((line) => line.startsWith('  • '));
    expect(bulletLines.length).toBeGreaterThanOrEqual(2);

    if (savedUrl !== undefined) process.env['INTERNAL_API_URL'] = savedUrl;
    if (savedSecret !== undefined) process.env['AUTH_JWT_SECRET_FOR_PROXY'] = savedSecret;
    vi.resetModules();
  });

  it('defaults NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED to the literal boolean false when the env var is unset', async () => {
    /*
     * Scenario: a fresh deploy that has not opted into Google OAuth should
     * boot cleanly with the feature disabled by default — the schema must
     * coerce a missing var to the literal boolean `false`, not to `true`
     * (which would surface the OAuth button to end users on every fresh
     * environment) and not to `undefined` (which would skip the
     * `enum`/`transform` pipeline entirely and break consumer type
     * narrowing). Pins the `.default(false)` literal so a regression to
     * `.default(true)` or `.default(undefined)` is caught at test time.
     */
    vi.resetModules();
    const saved = process.env['NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED'];
    delete process.env['NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED'];

    const { env } = await import('./env.js');

    expect(env.NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED).toBe(false);
    expect(typeof env.NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED).toBe('boolean');

    if (saved !== undefined) process.env['NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED'] = saved;
    vi.resetModules();
  });
});
