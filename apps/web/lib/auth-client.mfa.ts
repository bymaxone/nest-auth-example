/**
 * @fileoverview Dashboard MFA slice of the typed API client.
 *
 * Houses every helper that targets the lib's `/api/auth/mfa/*` endpoints
 * for the tenant user (setup → verify → challenge → disable → recovery
 * codes). The platform-admin variants live in `auth-client.platform.ts`
 * — they hit a separate controller (`/api/auth/platform/mfa/*`) under
 * a different auth contract (bearer token).
 *
 * Split out of `auth-client.ts` to keep the parent module under the
 * 800-line file cap. Public types `MfaSetupInfo`, `MfaStatusInfo`, and
 * `MfaRegenerateRecoveryCodesResult` live here too because the platform
 * module also references them.
 *
 * @module lib/auth-client.mfa
 */

import { apiFetch } from './auth-client';

// ── MFA types ─────────────────────────────────────────────────────────────────

/**
 * MFA setup response from `POST /api/auth/mfa/setup`.
 */
export interface MfaSetupInfo {
  /** Base32-encoded TOTP secret for manual entry in authenticator apps. */
  secret: string;
  /** `otpauth://totp/…` URI for QR code generation. */
  qrCodeUri: string;
  /** Plain-text recovery codes. Displayed once; never persisted in plain text. */
  recoveryCodes: string[];
}

/**
 * MFA status snapshot returned by `GET /api/account/mfa`.
 *
 * Powers the Security page's recovery-code counter, the low-codes
 * warning, and the "MFA required for this workspace" banner backed by
 * the API's `TenantMfaPolicyGuard`. Always safe to call — the endpoint is
 * JWT-protected and tenant-scoped server-side, and decorated with
 * `@SkipMfa()` so it works even before the user has enrolled (otherwise
 * the policy guard would 403 the very call the UI needs to drive
 * enrolment).
 */
export interface MfaStatusInfo {
  /** Whether the user has completed MFA enrollment. */
  enabled: boolean;
  /**
   * Count of unused recovery codes remaining. Always `0` when MFA is not
   * enabled. Each successful recovery-code login consumes one entry.
   */
  recoveryCodesRemaining: number;
  /**
   * Total recovery codes issued at enrollment (lib's
   * `mfa.recoveryCodeCount`, default 8). Used to render the "X of Y
   * remaining" indicator.
   */
  recoveryCodesTotal: number;
  /**
   * Whether the active workspace forces every user to enrol in MFA.
   * Mirrors the API's `TenantMfaPolicyGuard` policy (`MFA_REQUIRED_TENANT_SLUGS`
   * env var). When `true` and `enabled` is `false`, the dashboard layout
   * redirects to `/dashboard/security` because business endpoints will
   * 403 with `MFA_SETUP_REQUIRED`.
   */
  required: boolean;
}

/**
 * Response shape returned by `POST /auth/mfa/recovery-codes`.
 *
 * Mirrors what the lib's `MfaService.regenerateRecoveryCodes` returns —
 * a fresh array of plain-text recovery codes that must be displayed to
 * the user ONCE and never persisted in any client-side cache. The lib
 * has already replaced the stored scrypt hashes by the time this
 * resolves, so the previous code set is no longer accepted by
 * `/mfa/challenge`.
 *
 * @public
 */
export interface MfaRegenerateRecoveryCodesResult {
  /** Plain-text recovery codes. Display once and never persist. */
  recoveryCodes: string[];
}

// ── MFA helpers ───────────────────────────────────────────────────────────────

/**
 * Initiates the MFA setup flow for the authenticated user.
 *
 * Returns the TOTP secret, QR code URI, and plain-text recovery codes.
 * The recovery codes are shown once and must not be persisted in plain text.
 *
 * @returns `MfaSetupInfo` with `secret`, `qrCodeUri`, and `recoveryCodes`.
 */
export const mfaSetup = (): Promise<MfaSetupInfo> =>
  apiFetch<MfaSetupInfo>('/auth/mfa/setup', { method: 'POST' });

/**
 * Verifies the first TOTP code and permanently enables MFA on the account.
 *
 * Returns 204 No Content on success. After a successful call all existing
 * sessions are invalidated and the user must re-authenticate.
 *
 * @param code - 6-digit TOTP code from the authenticator app.
 */
export const mfaVerifyEnable = (code: string): Promise<void> =>
  apiFetch<void>('/auth/mfa/verify-enable', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

/**
 * Disables MFA on the authenticated user's account.
 *
 * Requires a valid TOTP code (recovery codes are not accepted by design).
 *
 * @param code - 6-digit TOTP code confirming the disable action.
 */
export const mfaDisable = (code: string): Promise<void> =>
  apiFetch<void>('/auth/mfa/disable', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

/**
 * Completes an OAuth-driven MFA challenge using the HttpOnly cookie
 * planted by the lib's OAuth callback (lib v1.0.7+).
 *
 * Unlike the password-login flow which carries the `mfaTempToken` in
 * the body (read from `sessionStorage`), the OAuth flow plants the
 * token in a `mfa_temp_token` HttpOnly cookie that is path-scoped to
 * `/api/auth/mfa` and unreadable from JavaScript. This helper posts
 * just the `code` — `tenantAwareFetch` includes credentials, the
 * browser sends the cookie automatically, and the lib's
 * `MfaController.challenge` reads the token from the cookie when the
 * body's `mfaTempToken` is absent.
 *
 * On success the lib clears the cookie and the response carries the
 * full session cookies. On failure (`MFA_INVALID_CODE`, `ACCOUNT_LOCKED`)
 * the cookie is also cleared because the underlying JWT is single-use
 * — a retry requires re-driving the OAuth flow to mint a fresh token.
 *
 * @param code - 6-digit TOTP code OR `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX` recovery code.
 */
export const mfaChallengeViaCookie = (code: string): Promise<unknown> =>
  apiFetch<unknown>('/auth/mfa/challenge', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

/**
 * Regenerates the authenticated user's MFA recovery codes after
 * verifying a current TOTP. Requires the same proof-of-possession the
 * disable flow asks for — recovery codes are intentionally not
 * accepted as the confirmation factor (a user who has lost their TOTP
 * should disable + re-enrol instead).
 *
 * Hits the lib's `POST /auth/mfa/recovery-codes` (shipped in
 * `@bymax-one/nest-auth` ≥ 1.0.6). Throws via `apiFetch` on any
 * non-2xx response — call sites should funnel the error into
 * `handleAuthClientError(err, { toast })`.
 *
 * @param code - 6-digit TOTP code from the authenticator app.
 * @returns The freshly issued plain-text recovery codes.
 */
export const mfaRegenerateRecoveryCodes = (
  code: string,
): Promise<MfaRegenerateRecoveryCodesResult> =>
  apiFetch<MfaRegenerateRecoveryCodesResult>('/auth/mfa/recovery-codes', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

/**
 * Fetches the MFA status snapshot for the authenticated user.
 *
 * Server-side endpoint reads `mfaEnabled` and the length of
 * `mfaRecoveryCodes` directly from Postgres. The plaintext / hashed
 * recovery codes never leave the server.
 *
 * @returns The user's MFA status with remaining recovery-code count.
 */
export const getMfaStatus = (): Promise<MfaStatusInfo> => apiFetch<MfaStatusInfo>('/account/mfa');
