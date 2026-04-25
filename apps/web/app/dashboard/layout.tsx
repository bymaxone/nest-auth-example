/**
 * @fileoverview Dashboard layout — topbar + sidebar + scrollable main content.
 *
 * Composes the fixed `Topbar` (64px) and sticky `Sidebar` (250px) into a
 * two-column shell that wraps every page under `app/dashboard/**`.
 *
 * Mobile: sidebar is hidden by default and toggled via the topbar hamburger.
 * Desktop (lg+): sidebar is always visible as a sticky column.
 *
 * The `requireAuth()` server call gates this layout so the proxy's edge check
 * is complemented by a server-side identity verification before any RSC renders.
 *
 * `<NotificationListener />` is mounted here (not in each page) so the single
 * WS connection and toast subscription is shared across all dashboard routes.
 *
 * @layer layouts
 */

import type { ReactNode } from 'react';
import { requireAuth } from '@/lib/require-auth';
import { NotificationListener } from '@/components/notifications/notification-listener';
import { DashboardShell } from './shell';

interface DashboardLayoutProps {
  /** Dashboard page content. */
  children: ReactNode;
}

/**
 * Server component that verifies auth and renders the dashboard shell with the
 * global notification listener.
 *
 * `requireAuth()` redirects to `/auth/login` on any auth failure before the
 * shell renders.
 *
 * @param children - Dashboard page content.
 */
export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  await requireAuth();

  return (
    <DashboardShell>
      <NotificationListener />
      {children}
    </DashboardShell>
  );
}
