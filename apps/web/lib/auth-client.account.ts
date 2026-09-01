/**
 * @fileoverview Account-management slice of the typed API client.
 *
 * Houses the `changePassword` helper and its input type, which target the
 * library's built-in `POST /api/auth/password/change` route (lib v1.1.0+):
 * re-validates the current password, enforces the password policy and breach
 * check on the new one, revokes every other session, and — in cookie mode —
 * keeps the caller's own session alive.
 *
 * The app also ships a custom `POST /api/account/change-password` endpoint as
 * a reference for building an app-owned flow on top of `AuthService`; the UI
 * uses the library route to stay library-faithful.
 *
 * Split out of `auth-client.ts` to keep the parent module under the
 * 800-line file cap; consumers keep importing from `@/lib/auth-client`
 * thanks to the barrel re-export there.
 *
 * @module lib/auth-client.account
 */

import { apiFetch } from './auth-client';

/**
 * Payload for the `changePassword` helper — mirrors the library's
 * `ChangePasswordDto` (`refreshToken` is only needed by bearer-mode callers;
 * cookie mode reads the refresh cookie).
 */
export interface ChangePasswordInput {
  /** User's current password for re-authentication. */
  currentPassword: string;
  /** Desired new password (minimum 15 characters — the library default). */
  newPassword: string;
}

/**
 * Changes the authenticated user's password via the library route.
 *
 * Backed by `POST /api/auth/password/change` (lib v1.1.0+). On success the
 * library revokes every OTHER session (their next request dies at the token
 * epoch check) and preserves the caller's session in cookie mode.
 *
 * @param input - `currentPassword` and `newPassword`.
 */
export const changePassword = (input: ChangePasswordInput): Promise<void> =>
  apiFetch<void>('/auth/password/change', {
    method: 'POST',
    body: JSON.stringify(input),
  });
