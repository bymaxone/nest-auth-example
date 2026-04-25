/**
 * @fileoverview Platform admin shell — client component that owns token-check and layout.
 *
 * On first render (browser mount), checks sessionStorage for a valid platform
 * access token. If absent, immediately redirects to `/platform/login`.
 * Renders `null` during the SSR pass and until the effect completes to avoid
 * flashing platform UI before the auth check has run.
 *
 * Composed by `app/platform/layout.tsx` (server component) so that the layout
 * itself can remain a server component while client-side state lives here.
 *
 * @layer layouts
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { PlatformTopbar } from '@/components/platform/platform-topbar';
import { PlatformSidebar } from '@/components/platform/platform-sidebar';
import { getPlatformAccessToken } from '@/lib/platform-auth';

interface PlatformShellProps {
  /** Platform page content rendered in the main column. */
  children: ReactNode;
}

/**
 * Client shell for the platform admin area.
 *
 * Verifies the platform access token exists in sessionStorage before rendering.
 * Redirects to `/platform/login` when the token is absent (e.g. after tab close,
 * token expiry, or direct navigation to a platform page without prior login).
 *
 * Returns `null` during SSR and on the first client render before the effect fires
 * to prevent content flashing.
 *
 * @param children - Platform page content.
 */
export function PlatformShell({ children }: PlatformShellProps) {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const token = getPlatformAccessToken();
    if (!token) {
      router.replace('/platform/login');
      return;
    }
    setIsReady(true);
  }, [router]);

  // Suppress rendering until the token check passes — no flash of platform content.
  if (!isReady) return null;

  return (
    <>
      <PlatformTopbar />

      {/* ── Page body — below the fixed topbar ── */}
      <div className="flex pt-16">
        <PlatformSidebar />

        {/* ── Main content ── */}
        <main className="min-w-0 flex-1 px-6 py-8">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </>
  );
}
