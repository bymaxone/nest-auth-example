/**
 * @fileoverview Platform admin tenant picker — selects a tenant for the users page.
 *
 * Fetches all tenants via `listPlatformTenants()` and renders a native `<select>`
 * element styled with Tailwind. On change, navigates to
 * `/platform/users?tenantId=<id>` via `router.replace` so the URL stays bookmarkable.
 *
 * @layer components/platform
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { listPlatformTenants, mapAuthClientError } from '@/lib/auth-client';
import { translateAuthError } from '@/lib/auth-errors';
import type { PlatformTenantInfo } from '@/lib/auth-client';

interface TenantPickerProps {
  /** Currently selected tenant ID (from URL search params). */
  selectedTenantId?: string;
}

/**
 * Tenant picker for the platform users page.
 *
 * Loads all tenants on mount, displays a `<select>`, and updates the URL
 * (via `router.replace`) when the operator picks a different tenant.
 *
 * @param selectedTenantId - Pre-selected tenant ID from the URL search param.
 */
export function TenantPicker({ selectedTenantId }: TenantPickerProps) {
  const router = useRouter();
  const [tenants, setTenants] = useState<PlatformTenantInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await listPlatformTenants();
      setTenants(data);
    } catch (err) {
      const { code } = mapAuthClientError(err);
      toast.error(translateAuthError(code === 'UNKNOWN' ? '' : code));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (id) {
      router.replace(`/platform/users?tenantId=${id}`);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="tenant-select" className="text-sm font-medium text-red-300">
        Select a tenant
      </label>
      <select
        id="tenant-select"
        disabled={isLoading}
        value={selectedTenantId ?? ''}
        onChange={handleChange}
        className="w-full max-w-xs rounded-lg border border-[rgba(239,68,68,0.25)] bg-[rgba(20,0,0,0.8)] px-3 py-2 text-sm text-red-100 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500/50 disabled:opacity-50"
        aria-label="Select a tenant to view its users"
      >
        <option value="" disabled>
          {isLoading ? 'Loading tenants…' : '— Choose a tenant —'}
        </option>
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.slug})
          </option>
        ))}
      </select>
    </div>
  );
}
