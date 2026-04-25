/**
 * @fileoverview Auth client singleton for apps/web.
 *
 * Wraps `createAuthClient` from `@bymax-one/nest-auth/client` targeting the
 * same-origin `/api` base URL. The Next.js rewrite in `next.config.mjs` forwards
 * `/api/*` to the NestJS service, so `credentials: 'include'` makes HttpOnly
 * cookies flow transparently without CORS preflight.
 *
 * This module is server/client-agnostic — it may be imported by both React
 * Server Components and client components. Keep it free of `'use client'` and
 * any Next.js server-only APIs.
 *
 * @module lib/auth-client
 */

import { createAuthClient, AuthClientError } from '@bymax-one/nest-auth/client';
import type { AuthErrorCode } from '@bymax-one/nest-auth/client';

/** Module-level singleton — shared across every page and hook in apps/web. */
export const authClient = createAuthClient({
  baseUrl: '/api',
  routePrefix: 'auth',
  credentials: 'include',
});

export { AuthClientError };
export type { AuthErrorCode };

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
    // With exactOptionalPropertyTypes, spread the optional field only when defined
    // to avoid assigning `undefined` to a non-undefined optional property.
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
