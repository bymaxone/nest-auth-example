/**
 * @fileoverview Auth client + typed API helpers for apps/web.
 *
 * Exports:
 * - `authClient` — wraps every auth flow (login, register, logout, MFA, etc.)
 *   from `@bymax-one/nest-auth/client`. Uses a tenant-aware fetch wrapper so
 *   the `X-Tenant-Id` header is injected on every outgoing request from the
 *   value stored in the `tenant_id` client cookie.
 * - `SessionInfo`, `TenantInfo`, `ProjectInfo`, `TenantUserInfo`, `InvitationInfo`,
 *   `PlatformTenantInfo`, `PlatformUserInfo` — typed shapes for non-auth API resources.
 * - Domain helpers (`listSessions`, `revokeSession`, `revokeAllSessions`,
 *   `listTenants`, `listUsers`, `updateUserStatus`, `listProjects`,
 *   `createProject`, `deleteProject`, `listInvitations`, `createInvitation`,
 *   `revokeInvitation`, `changePassword`) — thin fetch wrappers for each endpoint.
 * - Platform helpers (`platformLogin`, `platformLogout`, `listPlatformTenants`,
 *   `listPlatformUsers`, `platformUpdateUserStatus`) — bearer-authenticated platform
 *   admin API calls. Tokens are stored in sessionStorage via `lib/platform-auth`.
 * - `mapAuthClientError`, `handleAuthClientError` — error normalisation utilities.
 *
 * Every request goes through `tenantAwareFetch`, which wraps `createAuthFetch`
 * (handles 401 → silent refresh → retry) and injects `X-Tenant-Id` from the
 * `tenant_id` cookie when present. On the server side (RSCs), `document.cookie`
 * is undefined so `getCookie` returns undefined and the header is omitted —
 * acceptable because server calls use a JWT that already encodes `tenantId`.
 *
 * Platform calls use a separate `platformApiFetch` that reads the bearer access
 * token from sessionStorage and adds an `Authorization: Bearer` header. This
 * bypasses the cookie-based auth flow because platform sessions are always
 * bearer-mode (the library's `JwtPlatformGuard` reads the Authorization header).
 *
 * @module lib/auth-client
 */

import { createAuthClient, createAuthFetch, AuthClientError } from '@bymax-one/nest-auth/client';
import type { AuthFetch, AuthErrorCode } from '@bymax-one/nest-auth/client';

// ── Tenant cookie utility ─────────────────────────────────────────────────────

/**
 * Reads a cookie value by name from `document.cookie` (browser-only).
 *
 * Returns `undefined` in SSR / RSC contexts where `document` is not defined.
 *
 * @param name - Cookie name to look up.
 * @returns Cookie value string, or `undefined` when absent or in SSR.
 */
function getCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const prefix = `${name}=`;
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(prefix)) {
      return part.slice(prefix.length);
    }
  }
  return undefined;
}

// ── Fetch wrappers ────────────────────────────────────────────────────────────

/**
 * Inner fetch: handles 401 auto-refresh, single-flight dedup, and cookie
 * credentials. All API requests originate from this wrapper.
 */
const innerAuthFetch = createAuthFetch({
  baseUrl: '/api',
  routePrefix: 'auth',
  credentials: 'include',
});

/**
 * Wraps `innerAuthFetch` and injects the `X-Tenant-Id` header from the
 * `tenant_id` client cookie on every request.
 *
 * The `tenant_id` cookie is set (and updated) by `<TenantSwitcher />`.
 * When the cookie is absent the header is omitted — callers that target
 * endpoints that require it (e.g. registration) must set the cookie first.
 */
const tenantAwareFetch: AuthFetch = (input, init) => {
  const tenantId = getCookie('tenant_id');
  if (!tenantId) return innerAuthFetch(input, init);

  // Merge existing per-request headers with the X-Tenant-Id header.
  const headers = new Headers(init?.headers);
  headers.set('X-Tenant-Id', tenantId);

  const newInit: RequestInit = init !== undefined ? { ...init, headers } : { headers };
  return innerAuthFetch(input, newInit);
};

// ── Auth client ───────────────────────────────────────────────────────────────

/**
 * Module-level singleton — shared across every page and hook in apps/web.
 * Uses `tenantAwareFetch` so every auth call carries `X-Tenant-Id` automatically.
 */
export const authClient = createAuthClient({
  baseUrl: '/api',
  routePrefix: 'auth',
  authFetch: tenantAwareFetch,
});

export { AuthClientError };
export type { AuthErrorCode };

// ── Error mapping ─────────────────────────────────────────────────────────────

/**
 * Auth error codes that indicate a stale/revoked session requiring re-login.
 * Used by `mapAuthClientError` to populate the optional `redirectTo` field.
 */
const REDIRECT_TO_LOGIN_CODES = new Set<string>([
  'auth.token_expired',
  'auth.token_revoked',
  'auth.token_invalid',
]);

/**
 * Normalises any caught value from an auth call into a typed descriptor.
 *
 * Discriminates `AuthClientError` instances (carrying a server-issued `code`)
 * from generic `Error` objects and unknown values. Populates `redirectTo` for
 * token-lifecycle codes so callers can redirect without extra branching.
 *
 * @param error - The caught value from a try-catch around an auth call.
 * @returns Normalised error descriptor with `code`, `message`, and optional `redirectTo`.
 */
export function mapAuthClientError(error: unknown): {
  code: AuthErrorCode | 'UNKNOWN';
  message: string;
  redirectTo?: string;
} {
  if (error instanceof AuthClientError) {
    const code = (error.code ?? 'UNKNOWN') as AuthErrorCode | 'UNKNOWN';
    const message = error.body?.message ?? error.message;
    return REDIRECT_TO_LOGIN_CODES.has(code)
      ? { code, message, redirectTo: '/auth/login' as const }
      : { code, message };
  }

  return {
    code: 'UNKNOWN' as const,
    message: error instanceof Error ? error.message : 'An unexpected error occurred.',
  };
}

/** Minimal toast interface — keeps this file free of sonner imports (server-safe). */
interface ToastActions {
  /** Display an error toast notification. */
  error: (message: string) => void;
}

/** Navigation interface — keeps this file free of Next.js imports (server-safe). */
interface RouterActions {
  /** Navigate to the given path. */
  push: (path: string) => void;
}

/**
 * Surfaces an auth error as a toast notification and optionally navigates away.
 *
 * Intended for use in form `catch` blocks — pass the caught value, your sonner
 * `toast` object, and (for redirection) the Next.js `useRouter()` instance.
 *
 * @param error - The caught value from an auth call.
 * @param ctx   - Toast helper and optional router for automatic redirect.
 */
export function handleAuthClientError(
  error: unknown,
  ctx: { toast: ToastActions; router?: RouterActions },
): void {
  const { message, redirectTo } = mapAuthClientError(error);
  ctx.toast.error(message);
  if (redirectTo !== undefined && ctx.router !== undefined) {
    ctx.router.push(redirectTo);
  }
}

// ── Generic API fetch helper ──────────────────────────────────────────────────

/**
 * Sends an authenticated JSON request to a path relative to `/api`.
 *
 * Uses `tenantAwareFetch` so:
 * - The `X-Tenant-Id` header is injected automatically from the `tenant_id` cookie.
 * - 401 responses trigger a silent token refresh and a single retry.
 * - Cookies are always included (`credentials: 'include'`).
 *
 * Throws `AuthClientError` on non-2xx responses with the server's error message
 * when available, falling back to a generic message.
 *
 * @param path - Path relative to `/api` (e.g. `'/users'` or `'/auth/sessions'`).
 * @param init - Optional fetch init. `Content-Type` defaults to `application/json`.
 * @returns Parsed JSON body, or `undefined` for 204 No Content responses.
 * @throws `AuthClientError` on non-2xx responses.
 */
async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const existingHeaders =
    init.headers !== undefined ? (init.headers as Record<string, string>) : {};
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...existingHeaders,
  };

  const response = await tenantAwareFetch(path, { ...init, headers });

  if (response.status === 204) return undefined as T;

  const text = await response.text();

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed['message'] === 'string') {
        message = parsed['message'];
      }
    } catch {
      // Ignore — keep generic message when body is not JSON.
    }
    throw new AuthClientError(message, response.status);
  }

  if (!text) return undefined as T;

  return JSON.parse(text) as T;
}

// ── Session types ─────────────────────────────────────────────────────────────

/**
 * Active session record as returned by `GET /api/auth/sessions`.
 *
 * Mirrors the `SessionInfo` interface from the library's session service.
 * The `isCurrent` flag identifies the caller's own session so the UI can
 * show a "This device" badge without a separate lookup.
 */
export interface SessionInfo {
  /** First 8 characters of `sessionHash` — short display identifier. */
  id: string;
  /** Full SHA-256 hex hash of the original refresh token (used for revocation). */
  sessionHash: string;
  /** Human-readable device description (e.g. "Chrome on macOS"). */
  device: string;
  /** IP address from which the session was established. */
  ip: string;
  /** Whether this is the caller's current active session. */
  isCurrent: boolean;
  /** Unix timestamp (ms) when the session was first created. */
  createdAt: number;
  /** Unix timestamp (ms) of the most recent activity on this session. */
  lastActivityAt: number;
}

// ── Tenant types ──────────────────────────────────────────────────────────────

/**
 * Tenant as returned by `GET /api/tenants/me`.
 */
export interface TenantInfo {
  /** Unique tenant identifier (cuid). */
  id: string;
  /** Human-readable tenant name. */
  name: string;
  /** URL-safe tenant slug. */
  slug: string;
}

// ── Project types ─────────────────────────────────────────────────────────────

/**
 * Project as returned by `GET /api/projects` and `POST /api/projects`.
 */
export interface ProjectInfo {
  /** Unique project identifier (cuid). */
  id: string;
  /** Project name. */
  name: string;
  /** Tenant the project belongs to. */
  tenantId: string;
  /** User ID of the project owner. */
  ownerUserId: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-updated timestamp. */
  updatedAt: string;
}

// ── User types ────────────────────────────────────────────────────────────────

/**
 * Tenant user as returned by `GET /api/users` and `PATCH /api/users/:id/status`.
 */
export interface TenantUserInfo {
  /** Unique user identifier (cuid). */
  id: string;
  /** User's primary email address. */
  email: string;
  /** User's display name. */
  name: string;
  /** Authorization role within the tenant. */
  role: string;
  /** Account lifecycle status. */
  status: string;
  /** Whether TOTP MFA is enabled on the account. */
  mfaEnabled: boolean;
  /** Tenant the user belongs to. */
  tenantId: string;
  /** Whether the user's email address has been verified. */
  emailVerified: boolean;
  /** ISO 8601 timestamp of the most recent login. */
  lastLoginAt: string | null;
  /** ISO 8601 account creation timestamp. */
  createdAt: string;
}

// ── Invitation types ──────────────────────────────────────────────────────────

/**
 * Invitation record as returned by `GET /api/invitations`.
 */
export interface InvitationInfo {
  /** Unique invitation identifier (cuid). */
  id: string;
  /** Email address of the invitee. */
  email: string;
  /** Role the invitee will receive on acceptance. */
  role: string;
  /** Tenant the invitation belongs to. */
  tenantId: string;
  /** ISO 8601 expiry timestamp. */
  expiresAt: string;
  /** ISO 8601 acceptance timestamp, or `null` when still pending. */
  acceptedAt: string | null;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

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

// ── Password change input ─────────────────────────────────────────────────────

/**
 * Payload for the `changePassword` helper.
 */
export interface ChangePasswordInput {
  /** User's current password for re-authentication. */
  currentPassword: string;
  /** Desired new password (minimum 8 characters). */
  newPassword: string;
}

// ── Session helpers ───────────────────────────────────────────────────────────

/**
 * Lists all active sessions for the authenticated user.
 *
 * @returns Array of `SessionInfo` sorted newest-first.
 */
export const listSessions = (): Promise<SessionInfo[]> => apiFetch<SessionInfo[]>('/auth/sessions');

/**
 * Revokes a single session by its full SHA-256 session hash.
 *
 * @param sessionHash - Full 64-character SHA-256 hex hash from `SessionInfo.sessionHash`.
 */
export const revokeSession = (sessionHash: string): Promise<void> =>
  apiFetch<void>(`/auth/sessions/${sessionHash}`, { method: 'DELETE' });

/**
 * Revokes all sessions for the authenticated user except the current one.
 *
 * Call `POST /api/auth/logout` afterwards to also terminate the current session
 * when implementing a full "sign out everywhere" flow.
 */
export const revokeAllSessions = (): Promise<void> =>
  apiFetch<void>('/auth/sessions/all', { method: 'DELETE' });

// ── Tenant helpers ────────────────────────────────────────────────────────────

/**
 * Lists all tenants the authenticated user belongs to.
 *
 * @returns Array of `TenantInfo` objects.
 */
export const listTenants = (): Promise<TenantInfo[]> => apiFetch<TenantInfo[]>('/tenants/me');

// ── User helpers ──────────────────────────────────────────────────────────────

/**
 * Lists all users in the current tenant.
 *
 * Admin-only; requires the `ADMIN` (or higher) role in the JWT.
 *
 * @returns Array of `TenantUserInfo` objects.
 */
export const listUsers = (): Promise<TenantUserInfo[]> => apiFetch<TenantUserInfo[]>('/users');

/**
 * Updates a user's account status.
 *
 * Admin-only; requires the `ADMIN` (or higher) role in the JWT.
 *
 * @param id     - Target user ID.
 * @param status - New account status (`'ACTIVE'`, `'SUSPENDED'`, etc.).
 * @returns The updated `TenantUserInfo`.
 */
export const updateUserStatus = (id: string, status: string): Promise<TenantUserInfo> =>
  apiFetch<TenantUserInfo>(`/users/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

// ── Project helpers ───────────────────────────────────────────────────────────

/**
 * Lists all projects in the current tenant.
 *
 * @returns Array of `ProjectInfo` objects sorted newest-first.
 */
export const listProjects = (): Promise<ProjectInfo[]> => apiFetch<ProjectInfo[]>('/projects');

/**
 * Creates a new project in the current tenant.
 *
 * Admin-only; requires the `ADMIN` (or higher) role in the JWT.
 *
 * @param name - Human-readable project name.
 * @returns The newly created `ProjectInfo`.
 */
export const createProject = (name: string): Promise<ProjectInfo> =>
  apiFetch<ProjectInfo>('/projects', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

/**
 * Deletes a project by ID.
 *
 * Admin-only; tenant isolation is enforced server-side.
 *
 * @param id - Project ID to delete.
 */
export const deleteProject = (id: string): Promise<void> =>
  apiFetch<void>(`/projects/${id}`, { method: 'DELETE' });

// ── Invitation helpers ────────────────────────────────────────────────────────

/**
 * Lists all invitations (pending and accepted) for the current tenant.
 *
 * Admin-only; backed by the custom `GET /api/invitations` endpoint.
 *
 * @returns Array of `InvitationInfo` objects sorted newest-first.
 */
export const listInvitations = (): Promise<InvitationInfo[]> =>
  apiFetch<InvitationInfo[]>('/invitations');

/**
 * Creates an invitation for a new user to join the current tenant.
 *
 * Calls the library's `POST /api/auth/invitations` endpoint. The `tenantId`
 * is extracted from the caller's JWT on the server side — it is never passed
 * in the body to prevent tenant spoofing.
 *
 * @param email - Invitee's email address.
 * @param role  - Role the invitee will receive on acceptance.
 */
export const createInvitation = (email: string, role: string): Promise<void> =>
  apiFetch<void>('/auth/invitations', {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });

/**
 * Revokes (deletes) an invitation by ID.
 *
 * Backed by the custom `DELETE /api/invitations/:id` endpoint.
 *
 * @param id - Invitation ID to delete.
 */
export const revokeInvitation = (id: string): Promise<void> =>
  apiFetch<void>(`/invitations/${id}`, { method: 'DELETE' });

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

// ── Account helpers ───────────────────────────────────────────────────────────

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

// ── Platform fetch ────────────────────────────────────────────────────────────

/**
 * Reads the platform access token from sessionStorage (browser-only).
 *
 * Returns `null` in SSR contexts where `sessionStorage` is unavailable.
 * Duplicates `getPlatformAccessToken` from `lib/platform-auth` to avoid
 * a cross-module import cycle while keeping auth-client.ts self-contained.
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
  const existingHeaders =
    init.headers !== undefined ? (init.headers as Record<string, string>) : {};
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...existingHeaders,
  };
  if (token !== null) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(path, { ...init, headers, credentials: 'include' });

  if (response.status === 204) return undefined as T;

  const text = await response.text();

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed['message'] === 'string') {
        message = parsed['message'];
      }
    } catch {
      // Ignore — keep generic message when body is not JSON.
    }
    throw new AuthClientError(message, response.status);
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
