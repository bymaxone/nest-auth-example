/**
 * @fileoverview Auth error translator — maps every AUTH_ERROR_CODES value to a
 * user-facing English string.
 *
 * The `satisfies` expression on AUTH_ERROR_MESSAGES is a compile-time
 * exhaustiveness check: if the library adds a new key to AUTH_ERROR_CODES this
 * file will fail to compile until the matching message is added here, preventing
 * silent fallback to the generic error copy.
 *
 * @module lib/auth-errors
 */

import { AUTH_ERROR_CODES } from '@bymax-one/nest-auth/shared';

/**
 * User-facing strings for every key of `AUTH_ERROR_CODES`.
 *
 * The `satisfies` check enforces exhaustiveness — a new library error code
 * without a corresponding entry here is a compile-time error.
 */
const AUTH_ERROR_MESSAGES = {
  INVALID_CREDENTIALS: 'Invalid email or password.',
  ACCOUNT_LOCKED: 'Your account has been locked. Please contact support.',
  ACCOUNT_INACTIVE: 'Your account is inactive.',
  ACCOUNT_SUSPENDED: 'Your account has been suspended.',
  ACCOUNT_BANNED: 'Your account has been banned.',
  PENDING_APPROVAL: 'Your account is pending approval.',
  TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
  TOKEN_REVOKED: 'Your session was revoked. Please sign in again.',
  TOKEN_INVALID: 'Your session is invalid. Please sign in again.',
  REFRESH_TOKEN_INVALID: 'Your session could not be refreshed. Please sign in again.',
  SESSION_EXPIRED: 'Your session has expired.',
  SESSION_LIMIT_REACHED: 'You have reached the maximum number of active sessions.',
  SESSION_NOT_FOUND: 'Session not found.',
  EMAIL_ALREADY_EXISTS: 'An account with this email already exists.',
  EMAIL_NOT_VERIFIED: 'Please verify your email address before signing in.',
  MFA_REQUIRED: 'Multi-factor authentication is required.',
  MFA_INVALID_CODE: 'Invalid verification code. Please try again.',
  MFA_ALREADY_ENABLED: 'MFA is already enabled on your account.',
  MFA_NOT_ENABLED: 'MFA is not enabled on your account.',
  MFA_SETUP_REQUIRED: 'MFA setup is required to continue.',
  MFA_TEMP_TOKEN_INVALID: 'MFA session expired. Please sign in again.',
  RECOVERY_CODE_INVALID: 'Invalid recovery code.',
  PASSWORD_TOO_WEAK:
    'Password is too weak. Use at least 8 characters with a mix of letters, numbers, and symbols.',
  PASSWORD_RESET_TOKEN_INVALID: 'Password reset link is invalid. Please request a new one.',
  PASSWORD_RESET_TOKEN_EXPIRED: 'Password reset link has expired. Please request a new one.',
  OTP_INVALID: 'Invalid verification code.',
  OTP_EXPIRED: 'Verification code has expired. Please request a new one.',
  OTP_MAX_ATTEMPTS: 'Too many attempts. Please request a new code.',
  INSUFFICIENT_ROLE: 'You do not have permission to perform this action.',
  FORBIDDEN: 'Access denied.',
  INVALID_INVITATION_TOKEN: 'This invitation is invalid or has already been used.',
  OAUTH_FAILED: 'OAuth sign-in failed. Please try again.',
  OAUTH_EMAIL_MISMATCH: 'The email from your OAuth provider does not match this account.',
  PLATFORM_AUTH_REQUIRED: 'Platform administrator authentication is required.',
} satisfies Record<keyof typeof AUTH_ERROR_CODES, string>;

/**
 * Reverse-lookup map: AUTH_ERROR_CODES value → AUTH_ERROR_CODES key.
 * Built once at module load to avoid per-call iteration.
 */
const CODE_VALUE_TO_KEY = Object.fromEntries(
  (Object.entries(AUTH_ERROR_CODES) as [keyof typeof AUTH_ERROR_CODES, string][]).map(
    ([key, value]) => [value, key],
  ),
) as Partial<Record<string, keyof typeof AUTH_ERROR_CODES>>;

/**
 * Returns a user-facing message for the given library error code.
 *
 * Falls back to a generic message when `code` is not in `AUTH_ERROR_CODES`
 * (unexpected server error, network failure, or a future library code not yet
 * present in the installed version).
 *
 * @param code - The machine-readable error code string (e.g. `'auth.invalid_credentials'`).
 * @returns A localized, user-friendly error message string.
 */
export function translateAuthError(code: string): string {
  const key = CODE_VALUE_TO_KEY[code];
  if (key !== undefined) {
    return AUTH_ERROR_MESSAGES[key];
  }
  return 'An unexpected error occurred. Please try again.';
}
