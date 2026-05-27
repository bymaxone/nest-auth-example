/**
 * @fileoverview Account-management slice of the typed API client.
 *
 * Houses the `changePassword` helper and its input type, which target the
 * app-side `/api/account/change-password` endpoint (the lib does not ship
 * a built-in change-password route — by design the consumer controls the
 * "current password" challenge UX).
 *
 * Split out of `auth-client.ts` to keep the parent module under the
 * 800-line file cap; consumers keep importing from `@/lib/auth-client`
 * thanks to the barrel re-export there.
 *
 * @module lib/auth-client.account
 */

import { apiFetch } from './auth-client';

/**
 * Payload for the `changePassword` helper.
 */
export interface ChangePasswordInput {
  /** User's current password for re-authentication. */
  currentPassword: string;
  /** Desired new password (minimum 8 characters). */
  newPassword: string;
}

/**
 * Changes the authenticated user's password.
 *
 * Backed by the custom `POST /api/account/change-password` endpoint.
 * The endpoint re-validates `currentPassword` before updating the hash.
 *
 * @param input - `currentPassword` and `newPassword`.
 */
export const changePassword = (input: ChangePasswordInput): Promise<void> =>
  apiFetch<void>('/account/change-password', {
    method: 'POST',
    body: JSON.stringify(input),
  });
