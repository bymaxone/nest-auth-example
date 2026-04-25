/**
 * @fileoverview Dashboard shell — client component that owns sidebar toggle state.
 *
 * Wraps `Topbar` + `Sidebar` + `main` content in a responsive flex layout.
 * Extracted from `layout.tsx` so the server layout can call `requireAuth()`
 * while the sidebar open/close state (React `useState`) lives here.
 *
 * @layer layouts
 */

'use client';

import { useState } from 'react';
import { type ReactNode } from 'react';
import { Topbar } from '@/components/layout/topbar';
import { Sidebar } from '@/components/layout/sidebar';

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
