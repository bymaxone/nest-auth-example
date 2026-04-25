/**
 * @fileoverview Platform admin tenants table.
 *
 * Fetches all tenants via `listPlatformTenants()` on mount and renders a
 * shadcn `Table`. Each row is clickable and navigates to
 * `/platform/users?tenantId=<id>` so the operator can drill into users.
 *
 * Columns: Name · Slug · Created · Actions.
 * Empty state, loading skeleton, and error toast are all handled.
 *
 * FCM row #22 — Platform admin context.
 *
 * @layer components/platform
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { Building2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listPlatformTenants, mapAuthClientError } from '@/lib/auth-client';
import { translateAuthError } from '@/lib/auth-errors';
import type { PlatformTenantInfo } from '@/lib/auth-client';

/**
 * Table that lists all tenants in the system.
 *
 * Fetches on mount; each row navigates to the platform users page filtered
 * by the clicked tenant. Error codes are translated via `translateAuthError`.
 */
export function TenantsTable() {
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

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <p className="text-sm text-red-400/60">Loading tenants…</p>
      </div>
    );
  }

  if (tenants.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2">
        <Building2 className="h-10 w-10 text-red-800" />
        <p className="text-sm text-red-400/60">No tenants found.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[rgba(239,68,68,0.15)] bg-[rgba(20,0,0,0.6)]">
      <Table>
        <TableHeader>
          <TableRow className="border-[rgba(239,68,68,0.15)] hover:bg-transparent">
            <TableHead className="text-red-400/70">Name</TableHead>
            <TableHead className="text-red-400/70">Slug</TableHead>
            <TableHead className="text-red-400/70">Created</TableHead>
            <TableHead className="text-red-400/70">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tenants.map((tenant) => (
            <TableRow
              key={tenant.id}
              className="cursor-pointer border-[rgba(239,68,68,0.1)] hover:bg-[rgba(239,68,68,0.05)]"
              onClick={() => router.push(`/platform/users?tenantId=${tenant.id}`)}
            >
              <TableCell className="font-medium text-red-100">{tenant.name}</TableCell>
              <TableCell>
                <span className="rounded border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.08)] px-2 py-0.5 font-mono text-xs text-red-300">
                  {tenant.slug}
                </span>
              </TableCell>
              <TableCell className="text-sm text-red-400/60">
                {formatDistanceToNow(new Date(tenant.createdAt), { addSuffix: true })}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-red-400 hover:bg-[rgba(239,68,68,0.1)] hover:text-red-200"
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/platform/users?tenantId=${tenant.id}`);
                  }}
                >
                  View users
                  <ArrowRight className="h-3 w-3" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
