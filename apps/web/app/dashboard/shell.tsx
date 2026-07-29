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
 * The three decorative glow layers that sit behind the whole dashboard.
 *
 * They are what makes the cards' `backdrop-blur` visible: a blur filter over a
 * flat near-black page samples a uniform color and renders identically to no
 * blur at all. These wide, heavily blurred color fields give the glass surfaces
 * something to pick up, so the effect reads as depth rather than as a tint.
 * Mirrors the layers the auth layout already renders. Purely presentational and
 * never interactive.
 */
function AmbientGlow() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-32 -left-32 h-[500px] w-[500px] animate-glow-float rounded-full bg-[#ff6224] opacity-15 blur-[120px]" />
      <div className="absolute -top-20 -right-20 h-[400px] w-[400px] animate-glow-drift rounded-full bg-[#60a5fa] opacity-10 blur-[100px]" />
      <div className="absolute bottom-0 left-1/2 h-[300px] w-[300px] -translate-x-1/2 animate-glow-float rounded-full bg-[#f97316] opacity-[0.05] blur-[80px]" />
    </div>
  );
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
      <AmbientGlow />

      <Topbar onMenuOpen={() => setSidebarOpen(true)} />

      {/* ── Page body — below the fixed topbar ── */}
      <div className="flex pt-16">
        <Sidebar isOpen={sidebarOpen} onNavClick={() => setSidebarOpen(false)} />

        {/* Mobile sidebar backdrop */}
        {/* A real button rather than a click-handled div, so the open drawer
            can also be dismissed from the keyboard. */}
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Close navigation menu"
            className="fixed inset-0 z-90 bg-black/50 backdrop-blur-sm lg:hidden"
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
