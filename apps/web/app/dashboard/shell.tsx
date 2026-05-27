/**
 * @fileoverview Dashboard shell — client component that owns sidebar toggle state
 * and the tenant-MFA-policy redirect gate.
 *
 * Wraps `Topbar` + `Sidebar` + `main` content in a responsive flex layout.
 * Extracted from `layout.tsx` so the server layout can call `requireAuth()`
 * while the sidebar open/close state (React `useState`) lives here.
 *
 * The MFA-policy gate fetches `GET /api/account/mfa` once on mount and, if
 * the active workspace requires MFA but the user has not enrolled,
 * redirects to `/dashboard/security`. The redirect runs only when the user
 * is NOT already on the security page so the enrolment flow itself does
 * not bounce. The fetch is non-blocking: while it's in flight the page
 * renders normally — any business endpoint that 403s with
 * `MFA_SETUP_REQUIRED` is treated by the lib's auth client as a transient
 * error and the redirect below will land before the toast does.
 *
 * @layer layouts
 */

'use client';

import { useEffect, useState } from 'react';
import { type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Topbar } from '@/components/layout/topbar';
import { Sidebar } from '@/components/layout/sidebar';
import { getMfaStatus } from '@/lib/auth-client';

interface DashboardShellProps {
  /** Dashboard page content rendered in the main column. */
  children: ReactNode;
}

/**
 * Client shell for the dashboard — manages sidebar visibility state.
 *
 * @param children - Dashboard page content.
 */
export function DashboardShell({ children }: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Tenant-MFA-policy gate. Defaults to no-op when the API returns
  // `required: false`; only fires the redirect when (a) the workspace
  // requires MFA, (b) the user has not enrolled, and (c) the user is
  // on a page OTHER than `/dashboard/security`. The /security page
  // hosts the enrolment flow itself — redirecting it to itself would
  // create an infinite loop on the first render.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await getMfaStatus();
        if (cancelled) return;
        if (status.required && !status.enabled && pathname !== '/dashboard/security') {
          router.replace('/dashboard/security?reason=mfa_required');
        }
      } catch {
        // Status fetch failures are non-fatal — the user can still
        // navigate; the next protected endpoint will surface a 403
        // toast if enforcement is on and the policy applies.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return (
    <>
      <Topbar onMenuOpen={() => setSidebarOpen(true)} />

      {/* ── Page body — below the fixed topbar ── */}
      <div className="flex pt-16">
        <Sidebar isOpen={sidebarOpen} onNavClick={() => setSidebarOpen(false)} />

        {/* Mobile sidebar backdrop */}
        {sidebarOpen && (
          <div
            aria-hidden="true"
            className="z-90 fixed inset-0 bg-black/50 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* ── Main content ── */}
        <main className="min-w-0 flex-1 px-6 py-8">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </>
  );
}
