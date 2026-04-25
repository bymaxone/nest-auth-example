/**
 * @fileoverview Projects page — list and manage tenant projects.
 *
 * Server component: `requireAuth()` extracts the user's role from the JWT.
 * `isAdmin` is derived from role and passed to Client Components so the admin
 * controls (create + delete) are shown only to authorized users.
 *
 * @layer pages/dashboard/projects
 */

'use client';

import { useState } from 'react';
import { useSession } from '@bymax-one/nest-auth/react';
import { ProjectsList } from '@/components/dashboard/projects-list';
import { CreateProjectDialog } from '@/components/dashboard/create-project-dialog';

const ADMIN_ROLES = new Set(['OWNER', 'ADMIN']);

/**
 * Projects management page — shows tenant projects with create/delete controls
 * for admin users.
 */
export default function ProjectsPage() {
  const { user } = useSession();
  const [refreshKey, setRefreshKey] = useState(0);

  const isAdmin = user !== null && ADMIN_ROLES.has(user.role);

  return (
    <div className="flex flex-col gap-8">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-2xl font-bold text-white">Projects</h1>
          <p className="mt-1 text-sm text-[rgba(255,255,255,0.5)]">
            {isAdmin ? 'Create and manage your workspace projects.' : "Your workspace's projects."}
          </p>
        </div>

        {isAdmin && <CreateProjectDialog onSuccess={() => setRefreshKey((k) => k + 1)} />}
      </div>

      {/* ── Projects list ── */}
      <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-6">
        <ProjectsList isAdmin={isAdmin} refreshKey={refreshKey} />
      </div>
    </div>
  );
}
