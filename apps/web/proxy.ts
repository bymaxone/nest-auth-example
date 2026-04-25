/**
 * @fileoverview Next.js 16 auth proxy — gates every route against JWT cookies.
 *
 * Next.js 16 replaced `middleware.ts` with `proxy.ts` as the edge-interception
 * entry point. Next.js discovers this file at the project root and wires the
 * exported `proxy` function + `config.matcher` into the edge runtime automatically.
 *
 * Instantiates `createAuthProxy` from `@bymax-one/nest-auth/nextjs` with the full
 * §12.3 config from `docs/DEVELOPMENT_PLAN.md`.
 *
 * Route precedence (first match wins, so specifics come first):
 *   /dashboard/team/:path* → OWNER, ADMIN only
 *   /dashboard/invitations  → OWNER, ADMIN only
 *   /dashboard/:path*       → all tenant roles
 *   /platform/:path*        → SUPER_ADMIN, SUPPORT only
 *
 * Public routes bypass auth entirely. `publicRoutesRedirectIfAuthenticated`
 * sends authenticated users straight to their role-appropriate dashboard
 * instead of rendering the login/register pages again.
 *
 * @module proxy
 */

import { createAuthProxy } from '@bymax-one/nest-auth/nextjs';
import {
  AUTH_ACCESS_COOKIE_NAME,
  AUTH_REFRESH_COOKIE_NAME,
  AUTH_HAS_SESSION_COOKIE_NAME,
} from '@bymax-one/nest-auth/shared';
import { env } from '@/lib/env';

const authProxy = createAuthProxy({
  publicRoutes: [
    '/',
    '/auth/login',
    '/auth/register',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/auth/verify-email',
    '/auth/accept-invitation',
    '/platform/login',
  ],

  publicRoutesRedirectIfAuthenticated: ['/auth/login', '/auth/register'],

  protectedRoutes: [
    // More-specific patterns must come before the catch-all
    { pattern: '/dashboard/team/:path*', allowedRoles: ['OWNER', 'ADMIN'] },
    { pattern: '/dashboard/invitations', allowedRoles: ['OWNER', 'ADMIN'] },
    { pattern: '/dashboard/:path*', allowedRoles: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] },
    { pattern: '/platform/:path*', allowedRoles: ['SUPER_ADMIN', 'SUPPORT'] },
  ],

  loginPath: '/auth/login',

  getDefaultDashboard: (role: string) => (role.startsWith('PLATFORM') ? '/platform' : '/dashboard'),

  apiBase: env.INTERNAL_API_URL,
  jwtSecret: env.AUTH_JWT_SECRET_FOR_PROXY,

  blockedUserStatuses: ['BANNED', 'INACTIVE', 'SUSPENDED'],

  cookieNames: {
    access: AUTH_ACCESS_COOKIE_NAME,
    refresh: AUTH_REFRESH_COOKIE_NAME,
    hasSession: AUTH_HAS_SESSION_COOKIE_NAME,
  },

  userHeaders: {
    userId: 'x-user-id',
    role: 'x-user-role',
    tenantId: 'x-tenant-id',
    tenantDomain: 'x-tenant-domain',
  },
});

/**
 * Next.js 16 proxy handler — delegates directly to the auth proxy function.
 *
 * Exported without a wrapper to avoid a NextRequest version incompatibility
 * between the project's next@16.2.4 and the library's bundled next@16.2.3.
 * At runtime Next.js calls this function with a compatible NextRequest object.
 */
export const proxy = authProxy.proxy;

/**
 * Next.js proxy matcher — runs on every route except static assets.
 * Must be co-exported with `proxy` so Next.js reads both in one module.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public/).*)'],
};
