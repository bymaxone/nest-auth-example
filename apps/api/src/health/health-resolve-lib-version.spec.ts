/**
 * @file health-resolve-lib-version.spec.ts
 * @description Unit tests for the `resolveLibraryVersion` helper in `HealthController`.
 *
 * Tests the three error-path branches that cannot be reached in the main
 * `health.controller.spec.ts` file (where the real library is installed and
 * `resolveLibraryVersion` always succeeds at module load time):
 *
 * - Outer catch: `require.resolve` throws (library not installed) → lines 68–69.
 * - Loop exhausted: five consecutive package.json candidates have the wrong
 *   `name` field → line 67.
 * - Nullish version: correct `name` found but `version` is absent → `??` falsy
 *   branch on line 60.
 *
 * Because `resolveLibraryVersion` runs at module-load time (initialising
 * `LIB_VERSION`), `node:module` and `node:fs` are mocked via
 * `jest.unstable_mockModule` before the module is imported with a top-level
 * `await import()`. At load time the default mock (resolve throws) exercises
 * lines 68–69 automatically. The explicit tests exercise the remaining paths
 * by reconfiguring the mocks per call.
 *
 * @layer test
 * @see apps/api/src/health/health.controller.ts
 * @see docs/guidelines/testing-guidelines.md
 */

import { jest } from '@jest/globals';

// ─── Mocks (declared before unstable_mockModule so the factories close over them) ──

/**
 * Controls the return value / throw behaviour of `require.resolve` inside
 * `resolveLibraryVersion`. Default: throws "Cannot find module", which
 * exercises the outer catch at module-load time.
 */
const mockResolve = jest.fn<(specifier: string) => string>().mockImplementation((): string => {
  throw new Error('Cannot find module "@bymax-one/nest-auth"');
});

/**
 * Controls what `readFileSync` returns for the walk-up candidates.
 * Default: returns a wrong-name package JSON so the loop never matches.
 */
const mockReadFileSync = jest
  .fn<(path: unknown, encoding?: unknown) => string>()
  .mockReturnValue(JSON.stringify({ name: 'wrong-package', version: '0.0.0' }));

// ─── Module mocks (registered before dynamic import) ─────────────────────────

jest.unstable_mockModule('node:module', () => ({
  createRequire: jest.fn(() => Object.assign(jest.fn(), { resolve: mockResolve })),
}));

jest.unstable_mockModule('node:fs', () => ({
  readFileSync: mockReadFileSync,
}));

// ─── Subject under test ───────────────────────────────────────────────────────

// Dynamic import triggers module load. At that point `resolveLibraryVersion()`
// runs with `mockResolve` throwing → outer catch fires → LIB_VERSION = 'unknown'.
// This covers lines 68–69 without any explicit test call.
const { resolveLibraryVersion } = await import('./health.controller.js');

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('resolveLibraryVersion', () => {
  beforeEach(() => {
    // Full reset between tests so mockReturnValueOnce queues do not bleed across.
    mockResolve.mockReset();
    mockReadFileSync.mockReset();
    // Restore defaults.
    mockResolve.mockImplementation((): string => {
      throw new Error('Cannot find module "@bymax-one/nest-auth"');
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'wrong-package', version: '0.0.0' }));
  });

  it('returns "unknown" when require.resolve throws (outer catch — library not installed)', () => {
    // Scenario: the library is absent from node_modules; `require.resolve` raises
    // "Cannot find module". The outer catch must return 'unknown' instead of
    // propagating to prevent a startup crash.
    // Rule: covers lines 68–69 (outer catch block).
    expect(resolveLibraryVersion()).toBe('unknown');
  });

  it('returns "unknown" when all five walk-up package.json files have the wrong name (loop exhausted)', () => {
    // Scenario: the library is installed but its directory structure is unusual —
    // five consecutive parent directories all contain a package.json whose `name`
    // does not match '@bymax-one/nest-auth'. The for-loop exhausts and the fallback
    // `return 'unknown'` on line 67 is reached.
    // Rule: covers line 67 (post-loop return) and the `i < 5` false exit branch.
    mockResolve.mockReturnValueOnce('/fake/node_modules/@bymax-one/nest-auth/dist/index.js');
    // mockReadFileSync already returns wrong-name JSON on every call (default).

    expect(resolveLibraryVersion()).toBe('unknown');
  });

  it('returns "unknown" when the package.json has the correct name but no version field', () => {
    // Scenario: the library package.json is found at the first walk-up level but
    // does not include a `version` key. The nullish-coalescing expression
    // `parsed.version ?? 'unknown'` must fall through to 'unknown'.
    // Rule: covers the `??` falsy branch on line 60.
    mockResolve.mockReturnValueOnce('/fake/node_modules/@bymax-one/nest-auth/dist/index.js');
    mockReadFileSync.mockReturnValueOnce(JSON.stringify({ name: '@bymax-one/nest-auth' }));

    expect(resolveLibraryVersion()).toBe('unknown');
  });
});
