/**
 * @fileoverview Client providers tree — AuthProvider + Toaster.
 *
 * This is the only `'use client'` boundary in the root layout tree. The root
 * `app/layout.tsx` remains a server component; this file establishes the
 * React context required by `useSession`, `useAuth`, and `useAuthStatus`.
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
import { Toaster } from '@/components/ui/sonner';
import { authClient } from '@/lib/auth-client';

interface ProvidersProps {
  /** Page or layout content rendered inside the provider tree. */
  children: ReactNode;
}

/**
 * Root client provider that wires the auth state machine and toast system.
 *
 * Place this once in `app/layout.tsx`, wrapping `{children}`. Mounting it
 * higher (e.g. in `_app`) is not needed — the App Router layouts are the
 * equivalent.
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
      <Toaster />
    </AuthProvider>
  );
}
