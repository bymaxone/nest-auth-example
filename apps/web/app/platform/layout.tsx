/**
 * @fileoverview Platform admin layout — wraps every page under `app/platform/**`.
 *
 * This is a server component that renders `<PlatformShell>` (a client component).
 * The shell owns the token-check logic and the red-tinted topbar + sidebar that
 * make the platform area visually impossible to confuse with the tenant dashboard.
 *
 * Route: `/platform/*` (excluding `/platform/login` which has its own standalone layout).
 *
 * FCM row #22 — Platform admin context.
 *
 * @layer layouts
 */

import type { ReactNode } from 'react';
import { PlatformShell } from './shell';

interface PlatformLayoutProps {
  /** Platform admin page content. */
  children: ReactNode;
}

/**
 * Server component that delegates to the client `PlatformShell`.
 *
 * The shell performs a client-side sessionStorage check and redirects to
 * `/platform/login` when no platform access token is present. This layout does
 * NOT perform its own server-side auth check because platform sessions are
 * bearer-mode (tokens live in sessionStorage, not in cookies the RSC can read).
 *
 * Defense in depth: every `/api/platform/*` call is guarded by `JwtPlatformGuard`
 * and `PlatformRolesGuard` on the NestJS side — so even if this layout were
 * bypassed, no privileged data would be served.
 *
 * @param children - Platform page content.
 */
export default function PlatformLayout({ children }: PlatformLayoutProps) {
  return (
    <div className="min-h-screen bg-[#0d0505]">
      <PlatformShell>{children}</PlatformShell>
    </div>
  );
}
