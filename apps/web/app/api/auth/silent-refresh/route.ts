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

import { createSilentRefreshHandler } from '@bymax-one/nest-auth/nextjs';
import {
  AUTH_ACCESS_COOKIE_NAME,
  AUTH_REFRESH_COOKIE_NAME,
  AUTH_HAS_SESSION_COOKIE_NAME,
} from '@bymax-one/nest-auth/shared';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

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
