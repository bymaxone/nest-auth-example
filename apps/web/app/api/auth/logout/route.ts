/**
 * @fileoverview Logout route handler — revokes the session and clears auth cookies.
 *
 * Called by `<SignOutButton>` via `POST /api/auth/logout`. The handler clears all
 * auth cookies and redirects the browser to the login page. The revocation call to
 * NestJS blacklists the refresh token in Redis so it cannot be reused.
 *
 * @layer api/auth
 */

import { createLogoutHandler, LOGOUT_ROUTE } from '@bymax-one/nest-auth/nextjs';
import {
  AUTH_ACCESS_COOKIE_NAME,
  AUTH_REFRESH_COOKIE_NAME,
  AUTH_HAS_SESSION_COOKIE_NAME,
} from '@bymax-one/nest-auth/shared';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

/** Canonical path this handler is mounted at — called by the sign-out flow. */
export const PATH = LOGOUT_ROUTE;

/**
 * POST /api/auth/logout
 *
 * Delegates entirely to the library handler. Do not add custom auth logic here.
 *
 * @param request - Incoming POST request from the sign-out button.
 */
export const POST = createLogoutHandler({
  mode: 'redirect',
  apiBase: env.INTERNAL_API_URL,
  loginPath: '/auth/login',
  logoutPath: '/api/auth/logout',
  cookieNames: {
    access: AUTH_ACCESS_COOKIE_NAME,
    refresh: AUTH_REFRESH_COOKIE_NAME,
    hasSession: AUTH_HAS_SESSION_COOKIE_NAME,
  },
});
