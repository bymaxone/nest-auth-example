/**
 * @fileoverview Platform admin tenants list page.
 *
 * Lists every tenant in the system via `GET /api/platform/tenants`.
 * Accessible to both `SUPER_ADMIN` and `SUPPORT` roles.
 *
 * FCM row #22 — Platform admin context.
 *
 * @layer pages/platform
 */

import { Building2 } from 'lucide-react';
import { TenantsTable } from '@/components/platform/tenants-table';

/**
 * Platform tenants page — server component that renders the client `TenantsTable`.
 *
 * The data fetch is delegated to the client component so the bearer token
 * (stored in sessionStorage) can be read and forwarded in the request.
 */
export default function PlatformTenantsPage() {
  return (
    <div className="flex flex-col gap-6">
      {/* ── Page header ── */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)]">
          <Building2 className="h-5 w-5 text-red-400" />
        </div>
        <div>
          <h1 className="font-mono text-xl font-semibold text-red-100">Tenants</h1>
          <p className="text-sm text-red-400/60">All tenants registered in the system</p>
        </div>
      </div>

      {/* ── Table ── */}
      <TenantsTable />
    </div>
  );
}
