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
 * - `readAuthErrorCode` reads a code out of either error envelope the API
 *   may answer with, and reports none rather than guessing.
 *
 * @module lib/auth-errors.test
 */

import { describe, it, expect } from 'vitest';
import { AUTH_ERROR_CODES } from '@bymax-one/nest-auth/shared';
import { readAuthErrorCode, translateAuthError } from './auth-errors.js';

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

  it('returns the correct message for REAUTHENTICATION_REQUIRED', () => {
    /*
     * Scenario: sensitive flows (MFA setup) now demand a fresh password
     * confirmation — the code must map to copy telling the user to confirm
     * their password rather than a generic failure.
     * Protects: translateAuthError lookup for REAUTHENTICATION_REQUIRED
     * (added to AUTH_ERROR_CODES in lib 1.1.0).
     */
    const result = translateAuthError(AUTH_ERROR_CODES.REAUTHENTICATION_REQUIRED);
    expect(result).toBe('Please confirm your password to continue.');
  });

  it('returns the correct message for TOO_MANY_REQUESTS', () => {
    /*
     * Scenario: rate-limited requests must surface wait-and-retry copy so the
     * user does not hammer the endpoint further.
     * Protects: translateAuthError lookup for TOO_MANY_REQUESTS (new code set).
     */
    const result = translateAuthError(AUTH_ERROR_CODES.TOO_MANY_REQUESTS);
    expect(result).toBe('Too many requests. Please wait a moment and try again.');
  });

  it('returns the correct message for PASSWORD_COMPROMISED', () => {
    /*
     * Scenario: a breached password must map to copy that tells the user to
     * pick a different password — this code replaced the removed
     * PASSWORD_TOO_WEAK as the weak-password surface.
     * Protects: translateAuthError lookup for PASSWORD_COMPROMISED.
     */
    const result = translateAuthError(AUTH_ERROR_CODES.PASSWORD_COMPROMISED);
    expect(result).toBe(
      'This password has appeared in a known data breach. Please choose a different one.',
    );
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

// ── Envelope reading ──────────────────────────────────────────────────────────

describe('readAuthErrorCode', () => {
  it('reads the code out of the nested library envelope', () => {
    /*
     * Scenario: the API answers the shape the library emits,
     * `{ error: { code, message, details } }`.
     * Protects: the nested envelope is the current contract — failing to read
     * it is what makes every form show its generic fallback sentence.
     */
    const body = { error: { code: 'auth.invalid_credentials', message: 'no', details: null } };
    expect(readAuthErrorCode(body)).toBe('auth.invalid_credentials');
  });

  it('reads a top-level code from the older flat body', () => {
    /*
     * Scenario: the page is talking to a deployment that has not picked up the
     * envelope change yet.
     * Protects: a rollout where web and api are briefly on different versions
     * still shows the specific message rather than the fallback.
     */
    const body = { code: 'auth.token_expired', message: 'expired', statusCode: 401 };
    expect(readAuthErrorCode(body)).toBe('auth.token_expired');
  });

  it('prefers the nested code when a body carries both', () => {
    /*
     * Scenario: a body that satisfies both shapes at once.
     * Protects: the nested envelope wins, so the current contract is never
     * shadowed by a leftover top-level field.
     */
    const body = { code: 'auth.internal', error: { code: 'auth.forbidden' } };
    expect(readAuthErrorCode(body)).toBe('auth.forbidden');
  });

  it('falls through to the flat code when the envelope carries none', () => {
    /*
     * Scenario: `error` is present but is a bare string, the way some proxies
     * and framework defaults answer.
     * Protects: a non-conforming `error` field does not swallow a usable
     * top-level code.
     */
    const body = { error: 'Bad Request', code: 'auth.validation' };
    expect(readAuthErrorCode(body)).toBe('auth.validation');
  });

  it('reports no code when the envelope holds a non-string code', () => {
    /*
     * Scenario: `error.code` is a number.
     * Protects: only a string is returned, so a caller can pass the result
     * straight to `translateAuthError` without a type check of its own.
     */
    expect(readAuthErrorCode({ error: { code: 500 } })).toBe('');
  });

  it.each([
    ['a non-object body', 'auth.invalid_credentials'],
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
  ])('reports no code for %s', (_label, body) => {
    /*
     * Scenario: the response was not JSON, or parsing produced something that
     * is not an object at all.
     * Protects: the reader never indexes into a non-object, so a malformed
     * response degrades to the generic message instead of throwing inside the
     * error path — where a throw would replace the real failure.
     */
    expect(readAuthErrorCode(body)).toBe('');
  });

  it('reports no code when the body is an object with neither shape', () => {
    /*
     * Scenario: a well-formed JSON body that simply carries no error code.
     * Protects: nothing is invented; the caller gets the generic message.
     */
    expect(readAuthErrorCode({ detail: 'something went wrong' })).toBe('');
  });
});
