/**
 * @fileoverview Platform admin users page — tenant picker + user list with status controls.
 *
 * Reads `tenantId` from URL search params. When present, renders `<PlatformUsersTable>`
 * for that tenant; when absent, renders `<TenantPicker>` so the operator can choose.
 * Selecting a tenant updates the URL via `router.replace` which triggers a re-render
 * with the new `tenantId`.
 *
 * FCM row #22 — Platform admin context.
 *
 * @layer pages/platform
 */

import { Users } from 'lucide-react';
import { TenantPicker } from '@/components/platform/tenant-picker';
import { PlatformUsersTable } from '@/components/platform/platform-users-table';

interface PlatformUsersPageProps {
  /** Next.js App Router search params — may include `tenantId`. */
  searchParams: Promise<{ tenantId?: string }>;
}

/**
 * Platform users page — server component that reads `tenantId` from search params.
 *
 * When `tenantId` is present, delegates to `<PlatformUsersTable>` (a client component
 * that fetches with the bearer token and manages suspend/unsuspend state).
 * When absent, delegates to `<TenantPicker>` which loads all tenants and updates the URL.
 *
 * @param searchParams - Async search params provided by the App Router.
 */
export default async function PlatformUsersPage({ searchParams }: PlatformUsersPageProps) {
  const { tenantId } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Page header ── */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)]">
          <Users className="h-5 w-5 text-red-400" />
        </div>
        <div>
          <h1 className="font-mono text-xl font-semibold text-red-100">Users</h1>
          <p className="text-sm text-red-400/60">Manage users across tenants</p>
        </div>
      </div>

      {/* ── Tenant picker ── always visible so the operator can switch tenants */}
      <TenantPicker {...(tenantId !== undefined && { selectedTenantId: tenantId })} />

      {/* ── Users table or prompt ── */}
      {tenantId !== undefined ? (
        <PlatformUsersTable tenantId={tenantId} />
      ) : (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-[rgba(239,68,68,0.1)] bg-[rgba(20,0,0,0.4)]">
          <Users className="h-10 w-10 text-red-800" />
          <p className="text-sm text-red-400/60">Select a tenant above to view its users.</p>
        </div>
      )}
    </div>
  );
}
