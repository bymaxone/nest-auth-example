/**
 * @fileoverview Platform admin auth utilities — sessionStorage-backed token management.
 *
 * Platform sessions are always bearer-mode: the library returns access and refresh
 * tokens in the response body (not as cookies). sessionStorage persists across
 * in-tab navigation but clears on tab/browser close, which matches the operator
 * console threat model (no cross-session token leakage, automatic eviction).
 *
 * All functions perform a `typeof sessionStorage === 'undefined'` guard so this
 * module can be imported without errors in server-component contexts — every function
 * simply returns `null` when running server-side. Call sites in RSC are a bug;
 * use the `import 'client-only'` pattern in components that use these helpers.
 *
 * @module lib/platform-auth
 */

/** sessionStorage key for the platform access JWT. */
const PLATFORM_ACCESS_KEY = 'platform_access_token';

/** sessionStorage key for the opaque platform refresh token. */
const PLATFORM_REFRESH_KEY = 'platform_refresh_token';

/** sessionStorage key for the cached platform admin record. */
const PLATFORM_ADMIN_KEY = 'platform_admin';

/**
 * Minimal shape of the authenticated platform administrator.
 *
 * Mirrors `AuthPlatformUserClient` from `@bymax-one/nest-auth/shared` but kept
 * local so platform auth types do not depend on the library's shared barrel.
 */
export interface PlatformAdmin {
  /** Unique internal identifier for the platform administrator. */
  id: string;
  /** Platform administrator's primary email address. */
  email: string;
  /** Display name of the platform administrator. */
  name: string;
  /** Authorization role within the platform layer (`SUPER_ADMIN` | `SUPPORT`). */
  role: string;
  /** Account lifecycle status. */
  status: string;
}

/**
 * Reads the platform access token from sessionStorage.
 *
 * Returns `null` in SSR contexts where `sessionStorage` is undefined,
 * or when the key is absent (user has not logged in via the platform form).
 *
 * @returns The raw platform access JWT string, or `null`.
 */
export function getPlatformAccessToken(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage.getItem(PLATFORM_ACCESS_KEY);
}

/**
 * Reads the platform refresh token from sessionStorage.
 *
 * Returns `null` in SSR contexts or when the key is absent.
 *
 * @returns The opaque platform refresh token string, or `null`.
 */
export function getPlatformRefreshToken(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage.getItem(PLATFORM_REFRESH_KEY);
}

/**
 * Reads the cached platform admin record from sessionStorage.
 *
 * Returns `null` in SSR contexts, when the key is absent, or when the
 * stored value is not valid JSON. Callers should handle `null` gracefully.
 *
 * @returns The `PlatformAdmin` record, or `null`.
 */
export function getPlatformAdmin(): PlatformAdmin | null {
  if (typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(PLATFORM_ADMIN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PlatformAdmin;
  } catch {
    return null;
  }
}

/**
 * Persists platform auth tokens and admin record into sessionStorage after a
 * successful platform login.
 *
 * @param accessToken  - Short-lived platform access JWT.
 * @param refreshToken - Opaque platform refresh token.
 * @param admin        - Authenticated platform administrator record.
 */
export function setPlatformTokens(
  accessToken: string,
  refreshToken: string,
  admin: PlatformAdmin,
): void {
  sessionStorage.setItem(PLATFORM_ACCESS_KEY, accessToken);
  sessionStorage.setItem(PLATFORM_REFRESH_KEY, refreshToken);
  sessionStorage.setItem(PLATFORM_ADMIN_KEY, JSON.stringify(admin));
}

/**
 * Clears all platform auth state from sessionStorage.
 *
 * Called on explicit platform logout to ensure no stale tokens remain in the tab.
 */
export function clearPlatformTokens(): void {
  sessionStorage.removeItem(PLATFORM_ACCESS_KEY);
  sessionStorage.removeItem(PLATFORM_REFRESH_KEY);
  sessionStorage.removeItem(PLATFORM_ADMIN_KEY);
}
