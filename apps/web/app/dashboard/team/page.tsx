/**
 * @fileoverview Team management page — lists tenant members with admin controls.
 *
 * Server component: reads the authenticated user's role from the JWT via
 * `requireAuth()`. Passes `isAdmin` and `currentUserId` to the Client Component
 * table so it can show the status-toggle column only to admins.
 *
 * This page is visible only in the sidebar for `ADMIN` and `OWNER` roles. Direct
 * deep-linking by non-admins will render the page without the toggle column.
 *
 * @layer pages/dashboard/team
 */

import { requireAuth } from '@/lib/require-auth';
import { TeamTable } from '@/components/dashboard/team-table';

const ADMIN_ROLES = new Set(['OWNER', 'ADMIN']);

/**
 * Team page — shows all tenant members; admins also see status-toggle controls.
 */
export default async function TeamPage() {
  const session = await requireAuth();
  const isAdmin = ADMIN_ROLES.has(session.role);

  return (
    <div className="flex flex-col gap-8">
      {/* ── Page header ── */}
      <div>
        <h1 className="font-mono text-2xl font-bold text-white">Team</h1>
        <p className="mt-1 text-sm text-[rgba(255,255,255,0.5)]">
          View all members in your workspace
          {isAdmin ? ' and manage their account status' : ''}.
        </p>
      </div>

      {/* ── Team table ── */}
      <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-6">
        <TeamTable isAdmin={isAdmin} currentUserId={session.userId} />
      </div>
    </div>
  );
}
