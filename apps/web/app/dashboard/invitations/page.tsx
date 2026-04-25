/**
 * @fileoverview Invitations management page — create and revoke pending invitations.
 *
 * Server component: `requireAuth()` reads the JWT so we can pass `isAdmin` and
 * `currentUserId` as props. The invite form and invitations table are Client
 * Components that manage their own data-fetching state.
 *
 * The `refreshKey` counter increments after each new invitation so `InvitationsTable`
 * reloads without requiring a full page navigation.
 *
 * @layer pages/dashboard/invitations
 */

'use client';

import { useState } from 'react';
import { useSession } from '@bymax-one/nest-auth/react';
import { InviteForm } from '@/components/dashboard/invite-form';
import { InvitationsTable } from '@/components/dashboard/invitations-table';

const ADMIN_ROLES = new Set(['OWNER', 'ADMIN']);

/**
 * Invitations page — lets admins invite new members to the workspace.
 *
 * Non-admins see a read-only list of pending invitations (useful to see who
 * was already invited).
 */
export default function InvitationsPage() {
  const { user } = useSession();
  const [refreshKey, setRefreshKey] = useState(0);

  const isAdmin = user !== null && ADMIN_ROLES.has(user.role);

  return (
    <div className="flex flex-col gap-8">
      {/* ── Page header ── */}
      <div>
        <h1 className="font-mono text-2xl font-bold text-white">Invitations</h1>
        <p className="mt-1 text-sm text-[rgba(255,255,255,0.5)]">
          {isAdmin
            ? 'Invite new members to your workspace and manage pending invitations.'
            : 'Pending invitations for your workspace.'}
        </p>
      </div>

      {/* ── Invite form (admins only) ── */}
      {isAdmin && (
        <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-6">
          <h2 className="mb-4 font-mono text-sm font-semibold uppercase tracking-widest text-[rgba(255,255,255,0.4)]">
            Send invitation
          </h2>
          <InviteForm onSuccess={() => setRefreshKey((k) => k + 1)} />
        </div>
      )}

      {/* ── Pending invitations ── */}
      <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-6">
        <h2 className="mb-4 font-mono text-sm font-semibold uppercase tracking-widest text-[rgba(255,255,255,0.4)]">
          Pending invitations
        </h2>
        <InvitationsTable refreshKey={refreshKey} />
      </div>
    </div>
  );
}
