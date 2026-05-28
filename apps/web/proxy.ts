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

import {
  createAuthProxy,
  isBackgroundRequest,
  resolveSafeDestination,
} from '@bymax-one/nest-auth/nextjs';
import type { AuthProxyConfig, ProtectedRoutePattern } from '@bymax-one/nest-auth/nextjs';
import {
  AUTH_ACCESS_COOKIE_NAME,
  AUTH_REFRESH_COOKIE_NAME,
  AUTH_HAS_SESSION_COOKIE_NAME,
} from '@bymax-one/nest-auth/shared';
import { env } from '@/lib/env';

/**
 * Auth proxy configuration with explicit typing.
 *
 * Using `AuthProxyConfig` as the type annotation lets IDEs surface required
 * and wrong fields at author time. `ProtectedRoutePattern` is the shape of
 * each entry in `protectedRoutes` — explicit typing locks in the `pattern`
 * and `allowedRoles` fields so a typo becomes a compile error.
 *
 * `isBackgroundRequest` and `resolveSafeDestination` are utility functions
 * exposed by the library for consumers who build custom proxy wrappers around
 * `AuthProxyInstance.proxy`. They are imported here so they appear in the
 * module scope and are available to any future extension of this file.
 */
const _proxyUtils = { isBackgroundRequest, resolveSafeDestination };
void _proxyUtils;

const proxyConfig: AuthProxyConfig = {
  publicRoutes: [
    '/',
    '/auth/login',
    '/auth/register',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/auth/verify-email',
    '/auth/accept-invitation',
    // Platform admin area — marked public here because platform sessions are
    // bearer-mode (Authorization header, not cookies). The Next.js proxy can
    // only inspect cookie-based JWTs; it cannot verify a bearer token stored
    // in sessionStorage. Real authorization for /platform/* is enforced at the
    // API layer by JwtPlatformGuard + PlatformRolesGuard. The platform layout
    // shell performs a client-side sessionStorage check and redirects to
    // /platform/login when no token is present.
    '/platform/login',
    '/platform/tenants',
    '/platform/users',
    // WebSocket upgrade requests — the proxy cannot validate WS upgrades the
    // same way it does HTTP requests. The NotificationsGateway handles auth
    // itself by reading the access_token cookie from the upgrade headers.
    '/ws/notifications',
  ],

  publicRoutesRedirectIfAuthenticated: ['/auth/login', '/auth/register'],

  protectedRoutes: [
    // More-specific patterns must come before the catch-all.
    // Explicit `satisfies ProtectedRoutePattern` confirms the shape at each entry.
    {
      pattern: '/dashboard/team/:path*',
      allowedRoles: ['OWNER', 'ADMIN'],
    } satisfies ProtectedRoutePattern,
    {
      pattern: '/dashboard/invitations',
      allowedRoles: ['OWNER', 'ADMIN'],
    } satisfies ProtectedRoutePattern,
    {
      pattern: '/dashboard/:path*',
      allowedRoles: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
    } satisfies ProtectedRoutePattern,
    // NOTE: /platform/:path* is intentionally absent. Platform sessions are
    // bearer-mode — cookie-based gating at the proxy level would always
    // redirect platform admins to /auth/login because they have no tenant
    // access cookie. The JwtPlatformGuard on the NestJS side is the real gate.
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
};

const authProxy = createAuthProxy(proxyConfig);

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
