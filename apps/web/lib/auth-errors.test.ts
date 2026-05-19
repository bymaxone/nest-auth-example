/**
 * @fileoverview Unit tests for `lib/auth-errors`.
 *
 * Verifies:
 * - `translateAuthError` returns the correct user-facing string for every
 *   known `AUTH_ERROR_CODES` value.
 * - `translateAuthError` returns a generic fallback for an unknown code.
 * - The internal `AUTH_ERROR_MESSAGES` map covers every key in
 *   `AUTH_ERROR_CODES` (exhaustiveness guard — compile-time via `satisfies`,
 *   runtime via this test).
 *
 * @module lib/auth-errors.test
 */

import { describe, it, expect } from 'vitest';
import { AUTH_ERROR_CODES } from '@bymax-one/nest-auth/shared';
import { translateAuthError } from './auth-errors.js';

// ── Exhaustiveness check ──────────────────────────────────────────────────────

describe('AUTH_ERROR_MESSAGES coverage', () => {
  /*
   * Iterates every key in AUTH_ERROR_CODES and asserts that translateAuthError
   * returns a non-empty string — proving the internal map covers the full
   * library surface without re-exporting the private constant.
   */
  it.each(Object.keys(AUTH_ERROR_CODES) as (keyof typeof AUTH_ERROR_CODES)[])(
    'has a non-empty message for AUTH_ERROR_CODES.%s',
    (key) => {
      /*
       * Scenario: for every key in AUTH_ERROR_CODES the module must have a
       * corresponding user-facing string so no error silently falls through
       * to the generic fallback.
       * Protects: exhaustiveness enforced by `satisfies` at compile time and
       * this runtime coverage loop.
       */
      const code = AUTH_ERROR_CODES[key];
      const message = translateAuthError(code);
      // The result must be a non-empty string and must NOT be the generic fallback.
      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toBe('An unexpected error occurred. Please try again.');
    },
  );
});

// ── translateAuthError — known codes ─────────────────────────────────────────

describe('translateAuthError', () => {
  it('returns the correct message for INVALID_CREDENTIALS', () => {
    /*
     * Scenario: the most common auth failure must map to the inline message
     * that guides the user to re-enter correct credentials.
     * Protects: translateAuthError lookup for INVALID_CREDENTIALS.
     */
    const result = translateAuthError(AUTH_ERROR_CODES.INVALID_CREDENTIALS);
    expect(result).toBe('Invalid email or password.');
  });

  it('returns the correct message for TOKEN_EXPIRED', () => {
    /*
     * Scenario: an expired access token must map to the session-expired copy
     * so the user knows to sign in again.
     * Protects: translateAuthError lookup for TOKEN_EXPIRED.
     */
    const result = translateAuthError(AUTH_ERROR_CODES.TOKEN_EXPIRED);
    expect(result).toBe('Your session has expired. Please sign in again.');
  });

  it('returns the correct message for MFA_REQUIRED', () => {
    /*
     * Scenario: the MFA required code must map to an actionable message
     * directing the user to complete the MFA challenge.
     * Protects: translateAuthError lookup for MFA_REQUIRED.
     */
    const result = translateAuthError(AUTH_ERROR_CODES.MFA_REQUIRED);
    expect(result).toBe('Multi-factor authentication is required.');
  });

  it('returns the correct message for EMAIL_NOT_VERIFIED', () => {
    /*
     * Scenario: EMAIL_NOT_VERIFIED must direct the user to verify their
     * email before signing in.
     * Protects: translateAuthError lookup for EMAIL_NOT_VERIFIED.
     */
    const result = translateAuthError(AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
    expect(result).toBe('Please verify your email address before signing in.');
  });

  it('returns the correct message for ACCOUNT_LOCKED', () => {
    /*
     * Scenario: a locked account error must surface the support-contact copy
     * so the user knows they need help to unlock their account.
     * Protects: translateAuthError lookup for ACCOUNT_LOCKED.
     */
    const result = translateAuthError(AUTH_ERROR_CODES.ACCOUNT_LOCKED);
    expect(result).toBe('Your account has been locked. Please contact support.');
  });

  // ── Unknown / future codes ────────────────────────────────────────────────

  it('returns a generic fallback message for an unknown code', () => {
    /*
     * Scenario: a code that is not present in AUTH_ERROR_CODES (e.g. from a
     * future library version or a network error) must produce a safe,
     * non-empty fallback rather than undefined or an empty string.
     * Protects: graceful degradation in translateAuthError for unknown codes.
     */
    const result = translateAuthError('auth.unknown_future_code');
    expect(result).toBe('An unexpected error occurred. Please try again.');
  });

  it('returns the generic fallback for an empty string code', () => {
    /*
     * Scenario: an empty string is not a valid auth code; the function must
     * fall back to the generic message rather than throw.
     * Protects: robustness of translateAuthError against malformed input.
     */
    const result = translateAuthError('');
    expect(result).toBe('An unexpected error occurred. Please try again.');
  });
});
