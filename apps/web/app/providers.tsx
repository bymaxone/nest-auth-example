/**
 * @fileoverview Client auth boundary — establishes the `AuthProvider` context.
 *
 * Mounted by the layouts of the segments that need a session
 * (`app/auth`, `app/dashboard`), not by the root layout: the provider probes
 * the session on mount, and doing that app-wide made the public landing page
 * issue requests that can only be refused. The root layout stays a server
 * component either way; this file establishes the React context required by
 * `useSession`, `useAuth`, and `useAuthStatus`.
 *
 * `onSessionExpired` fires when the provider detects that a previously
 * authenticated session can no longer be refreshed — it redirects to the
 * login page with a `reason` param so the UI can surface a friendly message.
 *
 * @layer providers
 */

'use client';

import { type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AuthProvider } from '@bymax-one/nest-auth/react';
import type {
  AuthProviderProps,
  AuthContextValue,
  UseSessionResult,
  UseAuthResult,
  UseAuthStatusResult,
  AuthStatus,
} from '@bymax-one/nest-auth/react';
import { authClient } from '@/lib/auth-client';

interface ProvidersProps {
  /** Page or layout content rendered inside the provider tree. */
  children: ReactNode;
}

/**
 * Re-exported auth types for components that need to annotate hook return values
 * without a direct import from the library subpath.
 */
export type {
  AuthProviderProps,
  AuthContextValue,
  UseSessionResult,
  UseAuthResult,
  UseAuthStatusResult,
  AuthStatus,
};

/**
 * Client boundary establishing the `AuthProvider` context.
 *
 * Mount it in the layout of each segment whose routes need a session —
 * `app/auth/layout.tsx` and `app/dashboard/layout.tsx` today — not in
 * `app/layout.tsx`. The provider probes the session as soon as it mounts, so a
 * root-level mount makes public routes issue an identity request and a refresh
 * that can only ever be refused. A new authenticated segment has to mount it
 * too; nesting it under a layout that already does is unnecessary.
 *
 * The toaster is separate and lives in the root layout, because every area
 * toasts and it needs no session.
 *
 * @param children - Page or nested layout content.
 */
export default function Providers({ children }: ProvidersProps) {
  const router = useRouter();

  return (
    <AuthProvider
      client={authClient}
      onSessionExpired={() => router.push('/auth/login?reason=session_expired')}
    >
      {children}
    </AuthProvider>
  );
}
