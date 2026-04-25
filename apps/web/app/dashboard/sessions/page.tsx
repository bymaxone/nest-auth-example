/**
 * @fileoverview Sessions management page — view and revoke active sessions.
 *
 * Server component shell that provides the page heading. The sessions table
 * and the sign-out-everywhere button are Client Components.
 *
 * @layer pages/dashboard/sessions
 */

import { requireAuth } from '@/lib/require-auth';
import { SessionsTable } from '@/components/dashboard/sessions-table';
import { SignOutEverywhereButton } from '@/components/dashboard/sign-out-everywhere-button';

/**
 * Sessions page — displays all active sessions and exposes per-session and
 * bulk revocation actions.
 */
export default async function SessionsPage() {
  await requireAuth();

  return (
    <div className="flex flex-col gap-8">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-2xl font-bold text-white">Sessions</h1>
          <p className="mt-1 text-sm text-[rgba(255,255,255,0.5)]">
            View and revoke active sessions across all your devices.
          </p>
        </div>
        <SignOutEverywhereButton />
      </div>

      {/* ── Sessions table ── */}
      <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-6">
        <SessionsTable />
      </div>
    </div>
  );
}
