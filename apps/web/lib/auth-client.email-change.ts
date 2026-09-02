/**
 * @fileoverview Email-change slice of the typed API client.
 *
 * Wraps the library's two-step address-change flow (`controllers.emailChange`,
 * lib v1.1.0+):
 *
 *   1. `requestEmailChange` — `POST /api/auth/email/change` re-proves the
 *      current password and mails a single-use confirmation token to the NEW
 *      address (`emailChange.tokenTtlSeconds` bounds its lifetime).
 *   2. `confirmEmailChange` — `POST /api/auth/email/change/confirm` submits
 *      that token; the library adopts the new address and notifies the old one.
 *
 * Paths are derived from the library's canonical `AUTH_EMAIL_CHANGE_ROUTES`
 * constants so a route rename in the library surfaces here as a compile-time
 * diff instead of a silently broken hard-coded string.
 *
 * Split out of `auth-client.ts` to keep the parent module under the 800-line
 * file cap; consumers keep importing from `@/lib/auth-client` thanks to the
 * barrel re-export there.
 *
 * @module lib/auth-client.email-change
 */

import { AUTH_EMAIL_CHANGE_ROUTES } from '@bymax-one/nest-auth/shared';

import { apiFetch } from './auth-client';

/**
 * Payload for `requestEmailChange` — mirrors the library's `ChangeEmailDto`.
 *
 * `currentPassword` is required because the email address is the account's
 * recovery credential: a stolen access token alone must not be enough to point
 * the account at a mailbox the thief controls.
 */
export interface ChangeEmailInput {
  /** The address the account should move to. */
  newEmail: string;
  /** The account's current password, re-proved server-side. */
  currentPassword: string;
}

/**
 * Starts the email-change flow via the library route.
 *
 * Backed by `POST /api/auth/email/change`. On success the library mails a
 * confirmation link to `newEmail`; the account keeps its current address
 * until that link is confirmed, so a typo can never lock the owner out.
 *
 * @param input - `newEmail` and `currentPassword`.
 * @throws `AuthClientError` with `auth.invalid_credentials` on a wrong
 *   password or `auth.email_already_exists` when the address is taken.
 */
export const requestEmailChange = (input: ChangeEmailInput): Promise<void> =>
  apiFetch<void>(`/auth/${AUTH_EMAIL_CHANGE_ROUTES.request}`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

/**
 * Completes the email-change flow via the library route.
 *
 * Backed by `POST /api/auth/email/change/confirm`. The token is the whole
 * payload — it was minted naming the account, tenant, and target address, so
 * nothing else travels in the body (mirrors the library's
 * `ConfirmEmailChangeDto`).
 *
 * @param token - Single-use confirmation token from the emailed link.
 * @throws `AuthClientError` with `auth.email_change_token_invalid` when the
 *   token is unknown, expired, or already used.
 */
export const confirmEmailChange = (token: string): Promise<void> =>
  apiFetch<void>(`/auth/${AUTH_EMAIL_CHANGE_ROUTES.confirm}`, {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
