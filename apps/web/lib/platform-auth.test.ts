/**
 * @fileoverview Unit tests for `lib/platform-auth`.
 *
 * Verifies:
 * - All getter functions return `null` in SSR contexts (typeof sessionStorage === 'undefined').
 * - `getPlatformAccessToken` reads from the correct sessionStorage key.
 * - `getPlatformRefreshToken` reads from the correct sessionStorage key.
 * - `getPlatformAdmin` parses JSON correctly and returns `null` for absent/invalid entries.
 * - `setPlatformTokens` writes all three keys to sessionStorage.
 * - `clearPlatformTokens` removes all three keys from sessionStorage.
 *
 * SSR simulation: `vi.stubGlobal('sessionStorage', undefined)` replaces the
 * jsdom global with `undefined`, making `typeof sessionStorage === 'undefined'`
 * evaluate to `true` inside the module — matching real SSR behaviour.
 *
 * @module lib/platform-auth.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getPlatformAccessToken,
  getPlatformRefreshToken,
  getPlatformAdmin,
  setPlatformTokens,
  clearPlatformTokens,
} from './platform-auth.js';
import type { PlatformAdmin } from './platform-auth.js';

// ── Key constants (mirrors module-internal constants) ─────────────────────────

const PLATFORM_ACCESS_KEY = 'platform_access_token';
const PLATFORM_REFRESH_KEY = 'platform_refresh_token';
const PLATFORM_ADMIN_KEY = 'platform_admin';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Builds a minimal valid `PlatformAdmin` record. */
function makeAdmin(overrides: Partial<PlatformAdmin> = {}): PlatformAdmin {
  return {
    id: 'admin-1',
    email: 'admin@example.com',
    name: 'Platform Admin',
    role: 'SUPER_ADMIN',
    status: 'ACTIVE',
    ...overrides,
  };
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  sessionStorage.clear();
});

// ── getPlatformAccessToken ────────────────────────────────────────────────────

describe('getPlatformAccessToken', () => {
  it('returns null when sessionStorage is undefined (SSR context)', () => {
    /*
     * Scenario: the function is called in an SSR context where sessionStorage
     * does not exist. The guard `typeof sessionStorage === 'undefined'` must
     * short-circuit and return null without throwing.
     * Protects: SSR import safety — module can be imported in server components.
     */
    vi.stubGlobal('sessionStorage', undefined);
    try {
      expect(getPlatformAccessToken()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns null when the key is absent from sessionStorage', () => {
    /*
     * Scenario: the user has not yet logged in via the platform form so no
     * access token key exists in sessionStorage — the function must return null.
     * Protects: correct null-return when the platform session has not been set.
     */
    expect(getPlatformAccessToken()).toBeNull();
  });

  it('returns the stored value when the key is present', () => {
    /*
     * Scenario: after a successful platform login the access token is written
     * to sessionStorage; subsequent reads must return the stored JWT string.
     * Protects: happy-path read of the platform access token.
     */
    sessionStorage.setItem(PLATFORM_ACCESS_KEY, 'jwt.access.token');
    expect(getPlatformAccessToken()).toBe('jwt.access.token');
  });
});

// ── getPlatformRefreshToken ───────────────────────────────────────────────────

describe('getPlatformRefreshToken', () => {
  it('returns null when sessionStorage is undefined (SSR context)', () => {
    /*
     * Scenario: the function must not throw in SSR — it returns null safely.
     * Protects: SSR import safety for the refresh token getter.
     */
    vi.stubGlobal('sessionStorage', undefined);
    try {
      expect(getPlatformRefreshToken()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns null when the key is absent from sessionStorage', () => {
    /*
     * Scenario: no refresh token has been stored yet — returns null without error.
     * Protects: correct null-return when the platform refresh token is not set.
     */
    expect(getPlatformRefreshToken()).toBeNull();
  });

  it('returns the stored value when the key is present', () => {
    /*
     * Scenario: the refresh token was stored after login; reads must return it.
     * Protects: happy-path read of the platform refresh token.
     */
    sessionStorage.setItem(PLATFORM_REFRESH_KEY, 'opaque-refresh-token-xyz');
    expect(getPlatformRefreshToken()).toBe('opaque-refresh-token-xyz');
  });
});

// ── getPlatformAdmin ──────────────────────────────────────────────────────────

describe('getPlatformAdmin', () => {
  it('returns null when sessionStorage is undefined (SSR context)', () => {
    /*
     * Scenario: the function must not throw in SSR — it returns null safely
     * when sessionStorage is unavailable.
     * Protects: SSR import safety for the admin record getter.
     */
    vi.stubGlobal('sessionStorage', undefined);
    try {
      expect(getPlatformAdmin()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns null when the key is absent from sessionStorage', () => {
    /*
     * Scenario: no admin record has been stored — the function returns null
     * without throwing.
     * Protects: correct null-return when the admin key is not set.
     */
    expect(getPlatformAdmin()).toBeNull();
  });

  it('returns null when the stored value is invalid JSON', () => {
    /*
     * Scenario: if the stored string is not valid JSON (e.g. corrupted storage),
     * the JSON.parse must be caught and null returned rather than throwing.
     * Protects: graceful degradation on corrupted sessionStorage data.
     */
    sessionStorage.setItem(PLATFORM_ADMIN_KEY, 'not-valid-json{');
    expect(getPlatformAdmin()).toBeNull();
  });

  it('returns the parsed PlatformAdmin object when valid JSON is stored', () => {
    /*
     * Scenario: a valid JSON-serialised admin record is stored; the function
     * must parse and return it as a `PlatformAdmin` object.
     * Protects: happy-path read and deserialization of the admin record.
     */
    const admin = makeAdmin();
    sessionStorage.setItem(PLATFORM_ADMIN_KEY, JSON.stringify(admin));
    expect(getPlatformAdmin()).toEqual(admin);
  });

  it('returns null when the stored value is an empty string', () => {
    /*
     * Scenario: an empty string is a falsy raw value — the `if (!raw)` guard
     * must catch it and return null before attempting to parse.
     * Protects: early-exit guard for empty raw value.
     */
    sessionStorage.setItem(PLATFORM_ADMIN_KEY, '');
    expect(getPlatformAdmin()).toBeNull();
  });

  it('skips JSON.parse entirely when the stored value is empty (cheap early exit)', () => {
    /*
     * Scenario: when sessionStorage returns an empty string the `if (!raw)`
     * guard must return null BEFORE entering the try/catch. Removing the
     * guard would push the empty string through `JSON.parse('')`, throwing
     * a SyntaxError that the catch handler still maps to null — the
     * outward null is preserved but parse work is wasted on every read.
     * Pins the early-return path by asserting JSON.parse is not invoked.
     */
    const parseSpy = vi.spyOn(JSON, 'parse');
    sessionStorage.setItem(PLATFORM_ADMIN_KEY, '');
    try {
      expect(getPlatformAdmin()).toBeNull();
      expect(parseSpy).not.toHaveBeenCalled();
    } finally {
      parseSpy.mockRestore();
    }
  });
});

// ── setPlatformTokens ─────────────────────────────────────────────────────────

describe('setPlatformTokens', () => {
  it('writes access token, refresh token, and admin to their respective keys', () => {
    /*
     * Scenario: after a successful platform login, setPlatformTokens must persist
     * all three values so subsequent reads via the getters work correctly.
     * Protects: all three sessionStorage keys are written in a single call.
     */
    const admin = makeAdmin();
    setPlatformTokens('access-jwt', 'refresh-opaque', admin);

    expect(sessionStorage.getItem(PLATFORM_ACCESS_KEY)).toBe('access-jwt');
    expect(sessionStorage.getItem(PLATFORM_REFRESH_KEY)).toBe('refresh-opaque');
    expect(sessionStorage.getItem(PLATFORM_ADMIN_KEY)).toBe(JSON.stringify(admin));
  });

  it('overwrites previously stored values with new ones', () => {
    /*
     * Scenario: calling setPlatformTokens a second time (e.g. after token refresh)
     * must overwrite the old values, not append or leave stale data.
     * Protects: idempotent token update behaviour.
     */
    const admin1 = makeAdmin({ id: 'admin-1' });
    const admin2 = makeAdmin({ id: 'admin-2', email: 'new@example.com' });

    setPlatformTokens('first-access', 'first-refresh', admin1);
    setPlatformTokens('second-access', 'second-refresh', admin2);

    expect(sessionStorage.getItem(PLATFORM_ACCESS_KEY)).toBe('second-access');
    expect(sessionStorage.getItem(PLATFORM_REFRESH_KEY)).toBe('second-refresh');
    expect(sessionStorage.getItem(PLATFORM_ADMIN_KEY)).toBe(JSON.stringify(admin2));
  });
});

// ── clearPlatformTokens ───────────────────────────────────────────────────────

describe('clearPlatformTokens', () => {
  it('removes all three platform auth keys from sessionStorage', () => {
    /*
     * Scenario: calling clearPlatformTokens on logout must remove all three
     * keys so no stale tokens remain in the tab after sign-out.
     * Protects: complete cleanup of platform auth state on explicit logout.
     */
    const admin = makeAdmin();
    setPlatformTokens('access-jwt', 'refresh-opaque', admin);

    clearPlatformTokens();

    expect(sessionStorage.getItem(PLATFORM_ACCESS_KEY)).toBeNull();
    expect(sessionStorage.getItem(PLATFORM_REFRESH_KEY)).toBeNull();
    expect(sessionStorage.getItem(PLATFORM_ADMIN_KEY)).toBeNull();
  });

  it('does not throw when keys are already absent', () => {
    /*
     * Scenario: clearPlatformTokens must be idempotent — calling it on an empty
     * sessionStorage must not throw.
     * Protects: safe double-logout or cleanup on an already-clean state.
     */
    expect(() => clearPlatformTokens()).not.toThrow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});
