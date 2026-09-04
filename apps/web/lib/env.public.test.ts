/**
 * @fileoverview Unit tests for the `env.public` module.
 *
 * The point of this module is that it validates in the browser, where
 * `lib/env` cannot: it declares only `NEXT_PUBLIC_*` keys, so none of the
 * server-only variables are required. These tests pin that property directly —
 * the module is imported with every server-only variable absent, which is the
 * condition under which importing `lib/env` from a client component throws and
 * blanks the page.
 *
 * Modules are imported dynamically after the fake `process.env` values are
 * injected so Zod validation runs against controlled test data.
 *
 * @module lib/env.public.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

/** Original env snapshot — restored after all tests. */
const originalEnv = { ...process.env };

/** The public variables that have no default and must always be supplied. */
function setRequiredPublicEnv(): void {
  process.env['NEXT_PUBLIC_API_URL'] = 'http://localhost:3000/api';
  process.env['NEXT_PUBLIC_WS_URL'] = 'ws://localhost:3000';
}

/** Removes every variable the module might read, so each case starts clean. */
function clearPublicEnv(): void {
  delete process.env['NEXT_PUBLIC_API_URL'];
  delete process.env['NEXT_PUBLIC_WS_URL'];
  delete process.env['NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED'];
  delete process.env['NEXT_PUBLIC_PASSWORD_RESET_MODE'];
  delete process.env['INTERNAL_API_URL'];
  delete process.env['AUTH_JWT_SECRET_FOR_PROXY'];
}

beforeEach(() => {
  vi.resetModules();
  clearPublicEnv();
  setRequiredPublicEnv();
});

afterAll(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  vi.resetModules();
});

describe('publicEnv', () => {
  it('loads with every server-only variable absent', async () => {
    /*
     * Scenario: the browser, where `INTERNAL_API_URL` and
     * `AUTH_JWT_SECRET_FOR_PROXY` do not exist.
     * Protects: the whole reason this module is separate from `lib/env`. If a
     * server-only key ever creeps into this schema, importing it from a client
     * component throws at module load and the page renders blank with the cause
     * visible only in the console — which is exactly the regression this pins.
     */
    const { publicEnv } = await import('./env.public.js');

    expect(publicEnv.NEXT_PUBLIC_API_URL).toBe('http://localhost:3000/api');
    expect(publicEnv.NEXT_PUBLIC_WS_URL).toBe('ws://localhost:3000');
  });

  it('freezes the exported object', async () => {
    /*
     * Scenario: a caller tries to mutate the config at runtime.
     * Protects: `Object.freeze` on the parsed result, so config cannot be
     * reassigned from a component and diverge from what the build inlined.
     */
    const { publicEnv } = await import('./env.public.js');

    expect(Object.isFrozen(publicEnv)).toBe(true);
  });

  it('defaults the reset mode to token when the variable is unset', async () => {
    /*
     * Scenario: a deployment that never sets the flag — which is every
     * deployment that has not opted into code-based reset.
     * Protects: the default matches the API's own `PASSWORD_RESET_METHOD`
     * default, so the two cannot disagree by omission.
     */
    const { publicEnv } = await import('./env.public.js');

    expect(publicEnv.NEXT_PUBLIC_PASSWORD_RESET_MODE).toBe('token');
  });

  it('reads the reset mode when it is set to otp', async () => {
    /*
     * Scenario: the deployment mails a numeric code rather than a link.
     * Protects: the value is carried through, which is what routes the
     * forgot-password screen to the code-entry form instead of dead-ending.
     */
    process.env['NEXT_PUBLIC_PASSWORD_RESET_MODE'] = 'otp';

    const { publicEnv } = await import('./env.public.js');

    expect(publicEnv.NEXT_PUBLIC_PASSWORD_RESET_MODE).toBe('otp');
  });

  it('coerces the OAuth flag from its string form to a boolean', async () => {
    /*
     * Scenario: env vars are strings; `'false'` is truthy.
     * Protects: the transform, without which a disabled flag would still render
     * the Google button.
     */
    process.env['NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED'] = 'true';

    const { publicEnv } = await import('./env.public.js');

    expect(publicEnv.NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED).toBe(true);
  });

  it('throws with the offending key named when a public variable is malformed', async () => {
    /*
     * Scenario: a typo'd URL reaches the build.
     * Protects: the failure is loud and names the key, rather than arriving in a
     * component as `undefined` and failing somewhere unrelated later.
     */
    process.env['NEXT_PUBLIC_API_URL'] = 'not-a-url';

    await expect(import('./env.public.js')).rejects.toThrow(/NEXT_PUBLIC_API_URL/);
  });

  it('throws when a required public variable is missing', async () => {
    /*
     * Scenario: the variable was never set at build time.
     * Protects: a missing public value fails the build rather than being inlined
     * as `undefined` and surfacing as a broken request at runtime.
     */
    delete process.env['NEXT_PUBLIC_WS_URL'];

    await expect(import('./env.public.js')).rejects.toThrow(/Invalid public web env/);
  });
});
