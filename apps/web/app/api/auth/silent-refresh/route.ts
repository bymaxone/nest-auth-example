/**
 * @fileoverview Silent-refresh route handler — transparently rotates expired access tokens.
 *
 * Used by the auth proxy redirect flow: when the proxy detects an expired access token,
 * it redirects the browser to `/api/auth/silent-refresh?redirect=<destination>`. This
 * handler forwards the refresh cookie to NestJS, sets fresh cookies on the response,
 * and redirects back to the original destination.
 *
 * On failure (refresh token absent or revoked), the handler clears auth cookies and
 * redirects to the login page per the library's documented behaviour.
 *
 * @see FCM rows #27 (silent-refresh).
 * @layer api/auth
 */

import {
  createSilentRefreshHandler,
  SILENT_REFRESH_ROUTE,
  decodeJwtToken,
  isTokenExpired,
  buildSilentRefreshUrl,
} from '@bymax-one/nest-auth/nextjs';
import {
  AUTH_ACCESS_COOKIE_NAME,
  AUTH_REFRESH_COOKIE_NAME,
  AUTH_HAS_SESSION_COOKIE_NAME,
} from '@bymax-one/nest-auth/shared';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * Canonical path this handler is mounted at. The auth proxy redirects expired
 * access-token requests here; the URL is built with `buildSilentRefreshUrl`.
 * Consumers who inspect tokens before forwarding use `decodeJwtToken` +
 * `isTokenExpired` to distinguish truly expired tokens from tampered ones.
 *
 * @example
 * ```typescript
 * const decoded = decodeJwtToken(rawToken);
 * if (isTokenExpired(decoded)) {
 *   return redirect(buildSilentRefreshUrl('/dashboard', apiBase));
 * }
 * ```
 */
export const PATH = SILENT_REFRESH_ROUTE;

/**
 * GET /api/auth/silent-refresh
 *
 * Delegates entirely to the library handler. Do not add custom auth logic here.
 *
 * @param request - Incoming GET request from the proxy redirect.
 */
export const GET = createSilentRefreshHandler({
  apiBase: env.INTERNAL_API_URL,
  loginPath: '/auth/login',
  refreshPath: '/api/auth/refresh',
  cookieNames: {
    access: AUTH_ACCESS_COOKIE_NAME,
    refresh: AUTH_REFRESH_COOKIE_NAME,
    hasSession: AUTH_HAS_SESSION_COOKIE_NAME,
  },
});

/**
 * Re-exported token-inspection utilities for consumers who build custom
 * silent-refresh logic on top of the library primitives.
 */
export { decodeJwtToken, isTokenExpired, buildSilentRefreshUrl };
