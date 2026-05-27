/**
 * @fileoverview Platform-admin slice of the typed API client.
 *
 * Why it lives in its own module: the platform surface is bearer-mode
 * (Authorization header from `sessionStorage`), whereas the dashboard
 * surface in `auth-client.ts` is cookie-mode (`tenantAwareFetch`). Mixing
 * the two in a single file pushed the parent past the 800-line cap and
 * made the differing auth contracts harder to reason about. Splitting
 * keeps each contract self-contained while preserving the public import
 * path: `auth-client.ts` re-exports everything from here, so consumers
 * still write `import { platformLogin } from '@/lib/auth-client'`.
 *
 * Every helper in this file talks to `/api/platform/*` or
 * `/api/auth/platform/*` via `platformApiFetch`, which is private to the
 * module. The only shared dependency on the sibling module is
 * `buildAuthClientError` — exported `@internal` from `auth-client.ts`
 * so both files normalise non-2xx responses through the same code path.
 *
 * @module lib/auth-client.platform
 */

import { buildAuthClientError } from './auth-client';
import type { MfaRegenerateRecoveryCodesResult, MfaSetupInfo } from './auth-client';

// ── Platform types ────────────────────────────────────────────────────────────

/**
 * Tenant record as returned by `GET /api/platform/tenants`.
 *
 * Mirrors the Prisma `Tenant` model returned by `PlatformService.listTenants()`.
 */
export interface PlatformTenantInfo {
  /** Unique tenant identifier (cuid). */
  id: string;
  /** Human-readable tenant name. */
  name: string;
  /** URL-safe tenant slug. */
  slug: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-updated timestamp. */
  updatedAt: string;
}

/**
 * Platform admin account record — minimal shape from the login/me response.
 *
 * Mirrors `AuthPlatformUserClient` from `@bymax-one/nest-auth/shared`.
 */
export interface PlatformAdminInfo {
  /** Unique internal identifier for the platform administrator. */
  id: string;
  /** Primary email address. */
  email: string;
  /** Display name. */
  name: string;
  /** Platform role (`SUPER_ADMIN` | `SUPPORT`). */
  role: string;
  /** Account lifecycle status. */
  status: string;
}

/**
 * Successful platform login response from `POST /api/auth/platform/login`.
 *
 * Mirrors `PlatformBearerAuthResponse` from the library's token-delivery service.
 * Platform sessions are always bearer-mode — tokens live in the JSON body.
 */
export interface PlatformLoginSuccess {
  /** Authenticated platform administrator. */
  admin: PlatformAdminInfo;
  /** Short-lived platform access JWT. */
  accessToken: string;
  /** Opaque platform refresh token. */
  refreshToken: string;
}

/**
 * MFA challenge result — returned when the platform admin has MFA enabled.
 *
 * Exchange the `mfaTempToken` at `POST /api/auth/platform/mfa/challenge`.
 */
export interface PlatformMfaChallenge {
  /** Discriminant field — always `true` for the MFA path. */
  mfaRequired: true;
  /** Short-lived MFA temp token to exchange at the challenge endpoint. */
  mfaTempToken: string;
}

/**
 * Discriminated union for the platform login response.
 *
 * Branch on `'mfaRequired' in result` to distinguish the MFA path.
 */
export type PlatformLoginResult = PlatformLoginSuccess | PlatformMfaChallenge;

/**
 * User record as returned by `GET /api/platform/users` and
 * `PATCH /api/platform/users/:id/status`.
 *
 * Mirrors `PlatformSafeUser` from `PlatformService` (credentials stripped).
 */
export interface PlatformUserInfo {
  /** Unique user identifier (UUID). */
  id: string;
  /** User's primary email address. */
  email: string;
  /** User's display name. */
  name: string;
  /** Authorization role within the tenant. */
  role: string;
  /** Account lifecycle status. */
  status: string;
  /** Tenant the user belongs to. */
  tenantId: string;
  /** Whether the user's email has been verified. */
  emailVerified: boolean;
  /** Whether TOTP MFA is enabled on the account. */
  mfaEnabled: boolean;
  /** ISO 8601 timestamp of the most recent login, or `null`. */
  lastLoginAt: string | null;
  /** ISO 8601 account creation timestamp. */
  createdAt: string;
}

/**
 * Minimal projection of the authenticated platform admin returned by
 * `GET /api/auth/platform/me`. Only fields the security page needs are
 * surfaced — the lib's `SafeAuthPlatformUser` carries more, but the UI
 * does not need any of it today.
 *
 * @public
 */
export interface PlatformMeInfo {
  /** Platform admin email address. */
  email: string;
  /** Display name. */
  name: string;
  /** Platform role: `'SUPER_ADMIN'` or `'SUPPORT'`. */
  role: string;
  /** Whether TOTP MFA is enabled on the account. */
  mfaEnabled: boolean;
}

// ── Platform fetch ────────────────────────────────────────────────────────────

/**
 * Reads the platform access token from sessionStorage (browser-only).
 *
 * Returns `null` in SSR contexts where `sessionStorage` is unavailable.
 * Duplicates `getPlatformAccessToken` from `lib/platform-auth` to avoid
 * a cross-module import cycle while keeping this file self-contained.
 */
function readPlatformToken(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage.getItem('platform_access_token');
}

/**
 * Sends a bearer-authenticated JSON request to a platform API path.
 *
 * Reads the platform access token from sessionStorage and injects it as
 * `Authorization: Bearer <token>`. This path bypasses `tenantAwareFetch`
 * entirely — platform routes live under `/api/platform/*` and are guarded
 * server-side by `JwtPlatformGuard`, not by tenant JWT cookies.
 *
 * Throws `AuthClientError` on non-2xx responses with the server error message
 * when available, falling back to a generic message.
 *
 * @param path - Absolute path including `/api/` prefix (e.g. `/api/platform/tenants`).
 * @param init - Optional fetch init. `Content-Type` defaults to `application/json`.
 * @returns Parsed JSON body, or `undefined` for 204 No Content.
 * @throws `AuthClientError` on non-2xx responses.
 */
async function platformApiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = readPlatformToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token !== null) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(path, { ...init, headers, credentials: 'include' });

  if (response.status === 204) return undefined as T;

  const text = await response.text();

  if (!response.ok) {
    throw buildAuthClientError(response.status, text);
  }

  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

// ── Platform auth helpers ─────────────────────────────────────────────────────

/**
 * Authenticates a platform administrator with email and password.
 *
 * Posts to `POST /api/auth/platform/login`. Returns either a
 * `PlatformLoginSuccess` (with bearer tokens in the body) or a
 * `PlatformMfaChallenge` when the admin has MFA enabled.
 *
 * Store the returned tokens via `setPlatformTokens` from `lib/platform-auth`.
 *
 * @param email    - Platform admin email address.
 * @param password - Plain-text password (transmitted over HTTPS).
 * @returns `PlatformLoginResult` — discriminate on `'mfaRequired' in result`.
 */
export const platformLogin = (email: string, password: string): Promise<PlatformLoginResult> =>
  platformApiFetch<PlatformLoginResult>('/api/auth/platform/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

/**
 * Revokes the current platform administrator session.
 *
 * Sends `POST /api/auth/platform/logout` with the access token in the
 * `Authorization: Bearer` header and the refresh token in the request body.
 * After this call, clear sessionStorage tokens via `clearPlatformTokens()`.
 *
 * The platform logout endpoint blacklists the access token JTI in Redis and
 * deletes the refresh session. Any subsequent request guarded by
 * `JwtPlatformGuard` will be rejected.
 *
 * @param refreshToken - The opaque platform refresh token from sessionStorage.
 */
export const platformLogout = (refreshToken: string): Promise<void> => {
  const token = readPlatformToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== null) headers['Authorization'] = `Bearer ${token}`;

  return fetch('/api/auth/platform/logout', {
    method: 'POST',
    headers,
    body: JSON.stringify({ refreshToken }),
    credentials: 'include',
  }).then(() => undefined);
};

// ── Platform self-info helpers ────────────────────────────────────────────────

/**
 * Fetches the authenticated platform admin's profile.
 *
 * Powers the platform security page's initial branch — when `mfaEnabled`
 * is true the disable + regenerate cards render, otherwise the setup card.
 *
 * @returns Profile fields used by the security UI.
 */
export const platformGetMe = (): Promise<PlatformMeInfo> =>
  platformApiFetch<PlatformMeInfo>('/api/auth/platform/me');

// ── Platform MFA helpers ──────────────────────────────────────────────────────

/**
 * Initiates MFA enrolment for the authenticated platform administrator.
 *
 * Hits `POST /api/auth/platform/mfa/setup` (shipped in
 * `@bymax-one/nest-auth` ≥ 1.0.6 — the dashboard endpoint exists at
 * `/api/auth/mfa/setup`, the platform variant is a separate controller).
 * Returns the same `MfaSetupInfo` shape as the dashboard flow.
 *
 * @returns Setup payload with `secret`, `qrCodeUri`, and one-time `recoveryCodes`.
 */
export const platformMfaSetup = (): Promise<MfaSetupInfo> =>
  platformApiFetch<MfaSetupInfo>('/api/auth/platform/mfa/setup', { method: 'POST' });

/**
 * Verifies the first TOTP code from the platform admin's authenticator
 * app and permanently enables MFA on their account.
 *
 * After success the lib's `MfaService` invalidates all existing refresh
 * sessions (matching the dashboard contract), so the caller must
 * re-authenticate through the platform login → challenge flow on the
 * very next request that fails.
 *
 * @param code - 6-digit TOTP from the authenticator app.
 */
export const platformMfaVerifyEnable = (code: string): Promise<void> =>
  platformApiFetch<void>('/api/auth/platform/mfa/verify-enable', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

/**
 * Disables MFA on the authenticated platform admin's account.
 *
 * Mirrors the dashboard `mfaDisable` contract: TOTP-only (recovery codes
 * are intentionally not accepted as the confirmation factor), and
 * existing refresh sessions are invalidated after a successful disable.
 *
 * @param code - 6-digit TOTP code confirming the action.
 */
export const platformMfaDisable = (code: string): Promise<void> =>
  platformApiFetch<void>('/api/auth/platform/mfa/disable', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

/**
 * Regenerates the authenticated platform admin's recovery codes after
 * verifying a current TOTP. Mirrors the dashboard equivalent — semantics
 * are identical, only the route differs.
 *
 * @param code - 6-digit TOTP from the authenticator app.
 * @returns The freshly issued plain-text recovery codes (one-time display).
 */
export const platformMfaRegenerateRecoveryCodes = (
  code: string,
): Promise<MfaRegenerateRecoveryCodesResult> =>
  platformApiFetch<MfaRegenerateRecoveryCodesResult>('/api/auth/platform/mfa/recovery-codes', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

// ── Platform data helpers ─────────────────────────────────────────────────────

/**
 * Lists all tenants in the system.
 *
 * Calls `GET /api/platform/tenants` behind `JwtPlatformGuard`.
 * Accessible to both `SUPER_ADMIN` and `SUPPORT` roles.
 *
 * @returns Array of `PlatformTenantInfo` ordered by creation date.
 */
export const listPlatformTenants = (): Promise<PlatformTenantInfo[]> =>
  platformApiFetch<PlatformTenantInfo[]>('/api/platform/tenants');

/**
 * Lists all users in the specified tenant.
 *
 * Calls `GET /api/platform/users?tenantId=<id>` behind `JwtPlatformGuard`.
 * Credential fields (`passwordHash`, `mfaSecret`, etc.) are stripped server-side.
 *
 * @param tenantId - The tenant whose users should be listed.
 * @returns Array of `PlatformUserInfo` sorted newest-first.
 */
export const listPlatformUsers = (tenantId: string): Promise<PlatformUserInfo[]> =>
  platformApiFetch<PlatformUserInfo[]>(`/api/platform/users?tenantId=${tenantId}`);

/**
 * Updates a user's account status from the platform context.
 *
 * Calls `PATCH /api/platform/users/:id/status` behind `JwtPlatformGuard`.
 * Restricted to `SUPER_ADMIN` — `SUPPORT` is read-only.
 *
 * @param userId - Target user ID (UUID v4).
 * @param status - New account status (`'ACTIVE'`, `'SUSPENDED'`, etc.).
 * @returns The updated `PlatformUserInfo`.
 */
export const platformUpdateUserStatus = (
  userId: string,
  status: string,
): Promise<PlatformUserInfo> =>
  platformApiFetch<PlatformUserInfo>(`/api/platform/users/${userId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
