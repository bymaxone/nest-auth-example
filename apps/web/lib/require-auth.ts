/**
 * @fileoverview Server-side auth helpers for React Server Components.
 *
 * Reads the access-token cookie set by NestJS, verifies its signature locally
 * (no network hop — Edge-safe Web Crypto), and extracts typed identity claims.
 * On any failure, calls `redirect('/auth/login')` which throws `NEXT_REDIRECT`
 * and terminates the RSC render immediately.
 *
 * The auth proxy (proxy.ts) already gates navigation so these helpers are a
 * typed identity layer for RSCs that need `userId`, `role`, or `tenantId` at
 * render time without a second server round-trip.
 *
 * Server-only module — do not import in client components.
 *
 * @layer lib/server
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyJwtToken, getUserId, getUserRole, getTenantId } from '@bymax-one/nest-auth/nextjs';
import { AUTH_ACCESS_COOKIE_NAME } from '@bymax-one/nest-auth/shared';
import { env } from '@/lib/env';

/** Typed identity extracted from a verified access-token JWT. */
export interface AuthSession {
  /** Unique user identifier (UUID). */
  userId: string;
  /** Authorization role within the tenant (e.g. `'OWNER'`, `'MEMBER'`). */
  role: string;
  /**
   * Tenant identifier, or `null` for platform-admin tokens that have no
   * tenant scope.
   */
  tenantId: string | null;
  /** Raw access-token JWT — forward to downstream server calls if needed. */
  token: string;
}

/**
 * Verifies the access-token cookie and returns the caller's identity.
 *
 * Redirects to `/auth/login` when:
 *   - the cookie is absent (user is not signed in)
 *   - the token signature is invalid (tampered or wrong secret)
 *   - the token is expired (the proxy should have refreshed it, but RSC renders
 *     can arrive with a stale token in edge-cache scenarios)
 *
 * @returns Typed identity claims from the verified JWT.
 * @throws NEXT_REDIRECT to `/auth/login` on any auth failure.
 */
export async function requireAuth(): Promise<AuthSession> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_ACCESS_COOKIE_NAME)?.value;

  if (!token) redirect('/auth/login');

  try {
    const decoded = await verifyJwtToken(token, env.AUTH_JWT_SECRET_FOR_PROXY);
    return {
      userId: getUserId(decoded),
      role: getUserRole(decoded),
      tenantId: getTenantId(decoded) ?? null,
      token,
    };
  } catch {
    return redirect('/auth/login');
  }
}

/**
 * Like `requireAuth`, but also enforces that the caller's role is in `allowed`.
 *
 * Useful for RSCs that are reachable via deep-link but require a specific role
 * that the proxy does not enforce at the pattern level.
 *
 * @param allowed - Roles permitted to view this RSC.
 * @returns Typed identity claims.
 * @throws NEXT_REDIRECT to `/auth/login` when auth fails or role is not allowed.
 */
export async function requireRole(allowed: readonly string[]): Promise<AuthSession> {
  const session = await requireAuth();
  if (!allowed.includes(session.role)) redirect('/auth/login');
  return session;
}
