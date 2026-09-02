/**
 * @fileoverview Unit tests for `lib/auth-client.email-change`.
 *
 * Verifies:
 * - `requestEmailChange` POSTs the `ChangeEmailDto` body to the library's
 *   `email/change` route, with the path derived from `AUTH_EMAIL_CHANGE_ROUTES`.
 * - `confirmEmailChange` POSTs the `ConfirmEmailChangeDto` body (`{ token }`)
 *   to the library's `email/change/confirm` route.
 * - Both helpers propagate `apiFetch` rejections unchanged so callers can run
 *   them through `handleAuthClientError`.
 *
 * Strategy: `./auth-client` is mocked so `apiFetch` is a spy — the slice's
 * contract is exactly the path + init it hands to the shared fetch pipeline.
 *
 * @module lib/auth-client.email-change.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AUTH_EMAIL_CHANGE_ROUTES } from '@bymax-one/nest-auth/shared';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('./auth-client', () => ({
  apiFetch: vi.fn(),
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { apiFetch } from './auth-client';
import { requestEmailChange, confirmEmailChange } from './auth-client.email-change';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requestEmailChange', () => {
  it('POSTs newEmail and currentPassword to the library email/change route', async () => {
    /*
     * Scenario: starting the flow must hit the library's canonical
     * `email/change` route with the exact `ChangeEmailDto` field names —
     * a renamed field would be rejected by the server's ValidationPipe.
     * Protects: the path template and the JSON body shape.
     */
    vi.mocked(apiFetch).mockResolvedValue(undefined);

    await requestEmailChange({ newEmail: 'new@example.com', currentPassword: 'hunter2hunter2!' });

    expect(apiFetch).toHaveBeenCalledWith(`/auth/${AUTH_EMAIL_CHANGE_ROUTES.request}`, {
      method: 'POST',
      body: JSON.stringify({ newEmail: 'new@example.com', currentPassword: 'hunter2hunter2!' }),
    });
  });

  it('targets the literal /auth/email/change path', async () => {
    /*
     * Scenario: the route constant indirection must still resolve to the
     * wire path the API mounts — pinning the literal catches a library
     * constant repointed at a different route during an upgrade.
     * Protects: `AUTH_EMAIL_CHANGE_ROUTES.request` === 'email/change'.
     */
    vi.mocked(apiFetch).mockResolvedValue(undefined);

    await requestEmailChange({ newEmail: 'new@example.com', currentPassword: 'pw' });

    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe('/auth/email/change');
  });

  it('propagates apiFetch rejections unchanged', async () => {
    /*
     * Scenario: a wrong password surfaces as an `AuthClientError` from
     * `apiFetch`; the slice must not swallow or reshape it so the card's
     * catch block can route it through `handleAuthClientError`.
     * Protects: no try/catch inside the helper.
     */
    const failure = new Error('auth.invalid_credentials');
    vi.mocked(apiFetch).mockRejectedValue(failure);

    await expect(
      requestEmailChange({ newEmail: 'new@example.com', currentPassword: 'wrong' }),
    ).rejects.toBe(failure);
  });
});

describe('confirmEmailChange', () => {
  it('POSTs the token to the library email/change/confirm route', async () => {
    /*
     * Scenario: confirming must submit exactly `{ token }` — the token is
     * the whole payload (it names account, tenant, and target address), so
     * any extra field would be stripped or rejected by the server pipe.
     * Protects: the path template and the single-field body.
     */
    vi.mocked(apiFetch).mockResolvedValue(undefined);

    await confirmEmailChange('a'.repeat(64));

    expect(apiFetch).toHaveBeenCalledWith(`/auth/${AUTH_EMAIL_CHANGE_ROUTES.confirm}`, {
      method: 'POST',
      body: JSON.stringify({ token: 'a'.repeat(64) }),
    });
  });

  it('targets the literal /auth/email/change/confirm path', async () => {
    /*
     * Scenario: same literal pin as the request helper — the confirm URL
     * printed in emails must keep matching the wire path across library
     * upgrades.
     * Protects: `AUTH_EMAIL_CHANGE_ROUTES.confirm` === 'email/change/confirm'.
     */
    vi.mocked(apiFetch).mockResolvedValue(undefined);

    await confirmEmailChange('deadbeef');

    expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toBe('/auth/email/change/confirm');
  });

  it('propagates apiFetch rejections unchanged', async () => {
    /*
     * Scenario: an expired or reused token rejects with
     * `auth.email_change_token_invalid`; the confirm page translates it via
     * `translateAuthError`, so the slice must rethrow untouched.
     * Protects: no try/catch inside the helper.
     */
    const failure = new Error('auth.email_change_token_invalid');
    vi.mocked(apiFetch).mockRejectedValue(failure);

    await expect(confirmEmailChange('expired-token')).rejects.toBe(failure);
  });
});
