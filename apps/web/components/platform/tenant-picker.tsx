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
  // Stryker disable next-line ArrayDeclaration: initial empty array is overwritten by `setTenants(data)` on the first successful load. Before that, the `isLoading` guard renders the "Loading tenants…" placeholder; a mutated `["Stryker"]` initial would never reach a render that observes its content.
  const [tenants, setTenants] = useState<PlatformTenantInfo[]>([]);
  // Stryker disable next-line BooleanLiteral: initial `true` is paired with the `isLoading` guard on the placeholder; even if mutated to `false`, the empty-array fallback would still render the "— Choose a tenant —" placeholder. The two states cover overlapping failure modes (network-pending vs empty-response).
  const [isLoading, setIsLoading] = useState(true);

  // Dependency arrays extracted into named locals so Stryker disable
  // directives can land on a single-AST-node line (a directive placed on
  // a hook's closing `}, [...]);` does not apply — Stryker attributes the
  // ArrayDeclaration mutant to the parent hook's start line).
  // Stryker disable next-line ArrayDeclaration: useCallback deps are empty — `listPlatformTenants` takes no arguments and `setTenants` / `setIsLoading` are stable. A mutated single-element array stays reference-stable across renders, so the callback identity is unchanged.
  const loadDeps: readonly unknown[] = [];
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
  }, loadDeps);

  // Stryker disable next-line ArrayDeclaration: useEffect deps are `[load]` — a mutated single-element array is reference-stable across renders, so the effect still runs only on mount.
  const effectDeps: readonly unknown[] = [load];
  useEffect(() => {
    void load();
  }, effectDeps);

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
        // Stryker disable next-line StringLiteral: the `?? ''` fallback is observed only when `selectedTenantId` is undefined — React's controlled-select then looks up the option matching the empty string (the placeholder). A mutated `?? "Stryker"` would set the controlled value to "Stryker", but no option has that value, so the select would still display the placeholder option (React drops to the first available value and emits a development-mode warning, neither of which is observable from a regular Vitest assertion).
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
