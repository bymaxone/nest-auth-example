/**
 * @fileoverview Tenant switcher dropdown for the dashboard topbar.
 *
 * Fetches the list of tenants the signed-in user belongs to from
 * `GET /api/tenants/me`. On selection, writes the chosen tenant ID into the
 * `tenant_id` client cookie (1-year expiry, `SameSite=Lax`, `Secure` in
 * production) so `tenantAwareFetch` in `lib/auth-client.ts` can forward it as
 * `X-Tenant-Id` on every subsequent request. Calls `router.refresh()` so
 * Server Components re-render with the new tenant scope.
 *
 * The cookie is NOT HttpOnly — it must be readable by client code.
 * Security note: `tenantId` is not a secret; the server enforces tenant
 * isolation via the JWT `tenantId` claim and `UserStatusGuard`, not by
 * treating the header value as trusted input alone.
 *
 * Covers FCM row #20 (multi-tenant isolation via `X-Tenant-Id`).
 *
 * @layer components/auth
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { listTenants } from '@/lib/auth-client';
import type { TenantInfo } from '@/lib/auth-client';

/** Name of the client cookie used to store the active tenant ID. */
const TENANT_COOKIE = 'tenant_id';

/** Cookie max-age: 1 year in seconds. */
const ONE_YEAR_SECONDS = 31_536_000;

/**
 * Writes `tenant_id` to `document.cookie` with the appropriate security flags.
 *
 * `SameSite=Lax` prevents cross-site leakage while still allowing top-level
 * navigation. `Secure` is added when the page is served over HTTPS.
 *
 * @param tenantId - The tenant ID to persist.
 */
function writeTenantCookie(tenantId: string): void {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${TENANT_COOKIE}=${tenantId}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
}

/**
 * Reads the current `tenant_id` from `document.cookie`.
 *
 * @returns The stored tenant ID, or `undefined` when the cookie is absent.
 */
function readTenantCookie(): string | undefined {
  const prefix = `${TENANT_COOKIE}=`;
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(prefix)) {
      return part.slice(prefix.length);
    }
  }
  return undefined;
}

/**
 * Dropdown that lists the user's tenants and persists the selected one in a
 * client cookie so the API client can forward it as `X-Tenant-Id`.
 *
 * Renders nothing until the tenant list has loaded. On fetch failure a toast
 * is shown and the component remains invisible (not blocking the topbar).
 */
export function TenantSwitcher() {
  const router = useRouter();
  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    /** Loads tenant list and initialises the active tenant cookie. */
    const load = async () => {
      try {
        const list = await listTenants();
        setTenants(list);

        const storedId = readTenantCookie();
        // Use stored cookie if it matches a real tenant, otherwise default to first.
        const valid = list.find((t) => t.id === storedId) ?? list[0];
        if (valid) {
          setActiveTenantId(valid.id);
          if (storedId !== valid.id) {
            writeTenantCookie(valid.id);
          }
        }
      } catch {
        toast.error('Could not load tenant list.');
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  /**
   * Persists the selected tenant and refreshes the Server Component tree so
   * pages re-render with the new `X-Tenant-Id` scope.
   *
   * @param tenantId - The newly selected tenant ID.
   */
  const handleSelect = (tenantId: string) => {
    if (tenantId === activeTenantId) return;
    writeTenantCookie(tenantId);
    setActiveTenantId(tenantId);
    router.refresh();
  };

  const activeTenant = tenants.find((t) => t.id === activeTenantId);

  if (isLoading || tenants.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="hidden h-8 items-center gap-1.5 border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2.5 text-xs font-medium text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.08)] hover:text-white lg:flex"
          aria-label="Switch tenant"
        >
          <Building2 className="h-3.5 w-3.5 shrink-0 text-[#ff6224]" />
          <span className="max-w-[120px] truncate">{activeTenant?.name ?? 'Select tenant'}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-48 border-[rgba(255,255,255,0.08)] bg-[rgba(18,18,18,0.98)] backdrop-blur-md"
      >
        <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.35)]">
          Workspaces
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-[rgba(255,255,255,0.06)]" />

        {tenants.map((tenant) => (
          <DropdownMenuItem
            key={tenant.id}
            onClick={() => handleSelect(tenant.id)}
            className={
              tenant.id === activeTenantId
                ? 'cursor-pointer text-[#ff6224] focus:bg-[rgba(255,98,36,0.1)] focus:text-[#ff6224]'
                : 'cursor-pointer text-[rgba(255,255,255,0.7)] focus:bg-[rgba(255,255,255,0.05)] focus:text-white'
            }
          >
            <Building2 className="mr-2 h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{tenant.name}</span>
            {tenant.id === activeTenantId && (
              <span className="ml-auto text-[10px] text-[#ff6224]">✓</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
